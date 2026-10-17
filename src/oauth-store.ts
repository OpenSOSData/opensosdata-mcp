import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import * as path from 'path';
import * as fs from 'fs';

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'oauth.db');

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;
  ensureDataDir();
  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  initSchema(_db);
  return _db;
}

function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS clients (
      client_id TEXT PRIMARY KEY,
      client_secret TEXT,
      client_id_issued_at INTEGER,
      client_secret_expires_at INTEGER,
      metadata TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS auth_codes (
      code TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      code_challenge TEXT NOT NULL,
      redirect_uri TEXT NOT NULL,
      scopes TEXT NOT NULL DEFAULT '',
      state TEXT,
      api_key TEXT NOT NULL,
      resource TEXT,
      expires_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS access_tokens (
      token TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      scopes TEXT NOT NULL DEFAULT '',
      api_key TEXT NOT NULL,
      resource TEXT,
      expires_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS refresh_tokens (
      token TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      scopes TEXT NOT NULL DEFAULT '',
      api_key TEXT NOT NULL,
      resource TEXT,
      expires_at INTEGER NOT NULL
    );
  `);
}

export function generateToken(bytes: number = 32): string {
  return randomBytes(bytes).toString('hex');
}

// --- Client storage ---

export function storeClient(
  clientId: string,
  clientSecret: string | undefined,
  clientIdIssuedAt: number,
  clientSecretExpiresAt: number | undefined,
  metadata: object
): void {
  const db = getDb();
  db.prepare(`
    INSERT OR REPLACE INTO clients (client_id, client_secret, client_id_issued_at, client_secret_expires_at, metadata)
    VALUES (?, ?, ?, ?, ?)
  `).run(clientId, clientSecret ?? null, clientIdIssuedAt, clientSecretExpiresAt ?? null, JSON.stringify(metadata));
}

export function getClient(clientId: string): {
  client_id: string;
  client_secret: string | null;
  client_id_issued_at: number | null;
  client_secret_expires_at: number | null;
  metadata: string;
} | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM clients WHERE client_id = ?').get(clientId) as any;
}

// --- Auth code storage ---

export function storeAuthCode(
  code: string,
  clientId: string,
  codeChallenge: string,
  redirectUri: string,
  scopes: string[],
  state: string | undefined,
  apiKey: string,
  resource: string | undefined
): void {
  const db = getDb();
  const expiresAt = Math.floor(Date.now() / 1000) + 600; // 10 minutes
  db.prepare(`
    INSERT INTO auth_codes (code, client_id, code_challenge, redirect_uri, scopes, state, api_key, resource, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(code, clientId, codeChallenge, redirectUri, scopes.join(' '), state ?? null, apiKey, resource ?? null, expiresAt);
}

export function getAuthCode(code: string): {
  code: string;
  client_id: string;
  code_challenge: string;
  redirect_uri: string;
  scopes: string;
  state: string | null;
  api_key: string;
  resource: string | null;
  expires_at: number;
} | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM auth_codes WHERE code = ?').get(code) as any;
}

export function deleteAuthCode(code: string): void {
  const db = getDb();
  db.prepare('DELETE FROM auth_codes WHERE code = ?').run(code);
}

// --- Access token storage ---

export function storeAccessToken(
  token: string,
  clientId: string,
  scopes: string[],
  apiKey: string,
  resource: string | undefined,
  expiresInSeconds: number = 3600
): void {
  const db = getDb();
  const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds;
  db.prepare(`
    INSERT INTO access_tokens (token, client_id, scopes, api_key, resource, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(token, clientId, scopes.join(' '), apiKey, resource ?? null, expiresAt);
}

export function getAccessToken(token: string): {
  token: string;
  client_id: string;
  scopes: string;
  api_key: string;
  resource: string | null;
  expires_at: number;
} | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM access_tokens WHERE token = ?').get(token) as any;
}

export function deleteAccessToken(token: string): void {
  const db = getDb();
  db.prepare('DELETE FROM access_tokens WHERE token = ?').run(token);
}

// --- Refresh token storage ---

export function storeRefreshToken(
  token: string,
  clientId: string,
  scopes: string[],
  apiKey: string,
  resource: string | undefined,
  expiresInSeconds: number = 30 * 24 * 3600 // 30 days
): void {
  const db = getDb();
  const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds;
  db.prepare(`
    INSERT INTO refresh_tokens (token, client_id, scopes, api_key, resource, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(token, clientId, scopes.join(' '), apiKey, resource ?? null, expiresAt);
}

export function getRefreshToken(token: string): {
  token: string;
  client_id: string;
  scopes: string;
  api_key: string;
  resource: string | null;
  expires_at: number;
} | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM refresh_tokens WHERE token = ?').get(token) as any;
}

export function deleteRefreshToken(token: string): void {
  const db = getDb();
  db.prepare('DELETE FROM refresh_tokens WHERE token = ?').run(token);
}

// --- Cleanup expired records ---

export function cleanupExpired(): number {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  let deleted = 0;
  deleted += db.prepare('DELETE FROM auth_codes WHERE expires_at < ?').run(now).changes;
  deleted += db.prepare('DELETE FROM access_tokens WHERE expires_at < ?').run(now).changes;
  deleted += db.prepare('DELETE FROM refresh_tokens WHERE expires_at < ?').run(now).changes;
  return deleted;
}

// --- CSRF token storage ---

export function ensureCsrfTable(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS csrf_tokens (
      state_key TEXT PRIMARY KEY,
      token TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
  `);
}

export function storeCsrfToken(stateKey: string, token: string): void {
  ensureCsrfTable();
  const db = getDb();
  const expiresAt = Math.floor(Date.now() / 1000) + 600; // 10 minutes
  db.prepare(`
    INSERT OR REPLACE INTO csrf_tokens (state_key, token, expires_at)
    VALUES (?, ?, ?)
  `).run(stateKey, token, expiresAt);
}

export function getCsrfToken(stateKey: string): string | undefined {
  ensureCsrfTable();
  const db = getDb();
  const row = db.prepare("SELECT token, expires_at FROM csrf_tokens WHERE state_key = ?").get(stateKey) as any;
  if (!row) return undefined;
  if (row.expires_at < Math.floor(Date.now() / 1000)) {
    db.prepare("DELETE FROM csrf_tokens WHERE state_key = ?").run(stateKey);
    return undefined;
  }
  return row.token;
}

export function deleteCsrfToken(stateKey: string): void {
  ensureCsrfTable();
  const db = getDb();
  db.prepare("DELETE FROM csrf_tokens WHERE state_key = ?").run(stateKey);
}
