import { Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import {
  OAuthClientInformationFull,
  OAuthTokenRevocationRequest,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import { OAuthServerProvider, AuthorizationParams } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { InvalidGrantError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import * as store from './oauth-store';
import { randomBytes } from 'crypto';

const API_VALIDATION_URL = 'https://api.opensosdata.com/v1/account/balance';

async function validateApiKey(apiKey: string): Promise<boolean> {
  try {
    const res = await axios.get(API_VALIDATION_URL, {
      headers: { 'x-api-key': apiKey },
      timeout: 10000,
    });
    return res.status === 200;
  } catch {
    return false;
  }
}

// --- OAuthRegisteredClientsStore implementation ---

class ClientsStore implements OAuthRegisteredClientsStore {
  getClient(clientId: string): OAuthClientInformationFull | undefined {
    const row = store.getClient(clientId);
    if (!row) return undefined;
    const metadata = JSON.parse(row.metadata);
    return {
      ...metadata,
      client_id: row.client_id,
      client_secret: row.client_secret ?? undefined,
      client_id_issued_at: row.client_id_issued_at ?? undefined,
      client_secret_expires_at: row.client_secret_expires_at ?? undefined,
    };
  }

  registerClient(
    client: Omit<OAuthClientInformationFull, 'client_id' | 'client_id_issued_at'>
  ): OAuthClientInformationFull {
    const clientId = uuidv4();
    const clientIdIssuedAt = Math.floor(Date.now() / 1000);
    const clientSecret = client.client_secret ?? store.generateToken(32);
    // Extract metadata (everything except identity fields)
    const { client_secret, client_secret_expires_at, ...metadata } = client;
    store.storeClient(
      clientId,
      clientSecret,
      clientIdIssuedAt,
      client_secret_expires_at,
      metadata
    );
    return {
      ...metadata,
      client_id: clientId,
      client_secret: clientSecret,
      client_id_issued_at: clientIdIssuedAt,
      client_secret_expires_at: client_secret_expires_at,
    };
  }
}

// --- OAuthServerProvider implementation ---

export class OpenSOSDataOAuthProvider implements OAuthServerProvider {
  private _clientsStore = new ClientsStore();

  get clientsStore(): OAuthRegisteredClientsStore {
    return this._clientsStore;
  }

  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response
  ): Promise<void> {
    const clientName = client.client_name || client.client_id;
    // Generate CSRF token tied to the OAuth state parameter
    const csrfToken = randomBytes(32).toString('hex');
    const stateKey = params.state || client.client_id;
    store.storeCsrfToken(stateKey, csrfToken);
    const html = renderConsentPage(clientName, client.client_id, params, undefined, csrfToken);
    res.setHeader('Content-Type', 'text/html');
    res.status(200).send(html);
  }

  async challengeForAuthorizationCode(
    _client: OAuthClientInformationFull,
    authorizationCode: string
  ): Promise<string> {
    const row = store.getAuthCode(authorizationCode);
    if (!row) throw new InvalidGrantError('Authorization code not found');
    if (row.expires_at < Math.floor(Date.now() / 1000)) {
      store.deleteAuthCode(authorizationCode);
      throw new InvalidGrantError('Authorization code expired');
    }
    return row.code_challenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    _redirectUri?: string,
    resource?: URL
  ): Promise<OAuthTokens> {
    const row = store.getAuthCode(authorizationCode);
    if (!row) throw new InvalidGrantError('Authorization code not found');
    if (row.expires_at < Math.floor(Date.now() / 1000)) {
      store.deleteAuthCode(authorizationCode);
      throw new InvalidGrantError('Authorization code expired');
    }
    if (row.client_id !== client.client_id) {
      throw new InvalidGrantError('Authorization code was issued to a different client');
    }

    // Delete the code (single use)
    store.deleteAuthCode(authorizationCode);

    // Generate tokens
    const accessToken = store.generateToken(32);
    const refreshToken = store.generateToken(32);
    const scopes = row.scopes ? row.scopes.split(' ') : [];
    const resourceStr = resource?.toString() ?? row.resource ?? undefined;

    store.storeAccessToken(accessToken, client.client_id, scopes, row.api_key, resourceStr, 3600);
    store.storeRefreshToken(refreshToken, client.client_id, scopes, row.api_key, resourceStr);

    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: 3600,
      scope: scopes.join(' ') || undefined,
      refresh_token: refreshToken,
    };
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[],
    resource?: URL
  ): Promise<OAuthTokens> {
    const row = store.getRefreshToken(refreshToken);
    if (!row) throw new InvalidGrantError('Refresh token not found');
    if (row.expires_at < Math.floor(Date.now() / 1000)) {
      store.deleteRefreshToken(refreshToken);
      throw new InvalidGrantError('Refresh token expired');
    }
    if (row.client_id !== client.client_id) {
      throw new InvalidGrantError('Refresh token was issued to a different client');
    }

    // Delete old refresh token (rotation)
    store.deleteRefreshToken(refreshToken);

    // Generate new tokens
    const newAccessToken = store.generateToken(32);
    const newRefreshToken = store.generateToken(32);
    const tokenScopes = scopes ?? (row.scopes ? row.scopes.split(' ') : []);
    const resourceStr = resource?.toString() ?? row.resource ?? undefined;

    store.storeAccessToken(newAccessToken, client.client_id, tokenScopes, row.api_key, resourceStr, 3600);
    store.storeRefreshToken(newRefreshToken, client.client_id, tokenScopes, row.api_key, resourceStr);

    return {
      access_token: newAccessToken,
      token_type: 'Bearer',
      expires_in: 3600,
      scope: tokenScopes.join(' ') || undefined,
      refresh_token: newRefreshToken,
    };
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const row = store.getAccessToken(token);
    if (!row) throw new InvalidGrantError('Access token not found');
    if (row.expires_at < Math.floor(Date.now() / 1000)) {
      store.deleteAccessToken(token);
      throw new InvalidGrantError('Access token expired');
    }
    return {
      token,
      clientId: row.client_id,
      scopes: row.scopes ? row.scopes.split(' ') : [],
      expiresAt: row.expires_at,
      resource: row.resource ? new URL(row.resource) : undefined,
      extra: { apiKey: row.api_key },
    };
  }

  async revokeToken(
    client: OAuthClientInformationFull,
    request: OAuthTokenRevocationRequest
  ): Promise<void> {
    // Try to delete as access token first, then refresh token
    const accessRow = store.getAccessToken(request.token);
    if (accessRow && accessRow.client_id === client.client_id) {
      store.deleteAccessToken(request.token);
      return;
    }
    const refreshRow = store.getRefreshToken(request.token);
    if (refreshRow && refreshRow.client_id === client.client_id) {
      store.deleteRefreshToken(request.token);
    }
    // If token not found or belongs to different client, silently do nothing (per spec)
  }
}

// --- Consent page handler (called from http-server.ts) ---

export async function handleConsentSubmit(
  clientId: string,
  codeChallenge: string,
  redirectUri: string,
  state: string | undefined,
  scopes: string[],
  resource: string | undefined,
  apiKey: string,
  csrfToken: string | undefined,
  res: Response
): Promise<void> {
  // Validate CSRF token
  const stateKey = state || clientId;
  const storedCsrf = store.getCsrfToken(stateKey);
  if (!storedCsrf || storedCsrf !== csrfToken) {
    res.status(403).json({ error: 'Invalid or missing CSRF token' });
    return;
  }
  // Delete CSRF token (one-time use)
  store.deleteCsrfToken(stateKey);

  // Validate the API key
  const valid = await validateApiKey(apiKey);
  if (!valid) {
    const errorHtml = renderConsentPage(
      clientId, clientId,
      { codeChallenge, redirectUri, state, scopes, resource: resource ? new URL(resource) : undefined },
      'Invalid API key. Please check your key and try again.'
    );
    res.setHeader('Content-Type', 'text/html');
    res.status(200).send(errorHtml);
    return;
  }

  // Generate authorization code
  const code = store.generateToken(32);
  store.storeAuthCode(code, clientId, codeChallenge, redirectUri, scopes, state, apiKey, resource);

  // Redirect to the client's redirect URI with code and state
  const url = new URL(redirectUri);
  url.searchParams.set('code', code);
  if (state) url.searchParams.set('state', state);
  res.redirect(url.toString());
}

// --- HTML rendering ---

function renderConsentPage(
  clientName: string,
  clientId: string,
  params: AuthorizationParams,
  errorMessage?: string,
  csrfToken?: string
): string {
  const escapedClientName = escapeHtml(clientName);
  const escapedError = errorMessage ? `<div class="error">${escapeHtml(errorMessage)}</div>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Authorize - OpenSOSData</title>
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Ctext x='32' y='32' text-anchor='middle' dominant-baseline='central' font-family='Inter,-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif' font-size='60' font-weight='800' fill='%237C3AED'%3EO%3C/text%3E%3C/svg%3E">
  <style>
    @font-face { font-family: 'Inter'; font-style: normal; font-weight: 400 800; font-display: swap; src: url(/fonts/inter-latin.woff2) format('woff2'); unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Inter', system-ui, -apple-system, sans-serif; font-weight: 400; background: #0a0c12; color: #e5e7eb; min-height: 100vh; display: flex; flex-direction: column; position: relative; }
    .header { padding: 16px 24px; display: flex; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.05); }
    .brand { font-family: 'Inter', system-ui, -apple-system, sans-serif; font-weight: 800; font-size: 20px; color: #F9FAFB; letter-spacing: -0.01em; }
    .brand .sos { color: #8B5CF6; }
    .container { flex: 1; display: flex; align-items: center; justify-content: center; padding: 24px; }
    .card { background: #15171f; border-radius: 16px; border: 0.5px solid rgba(255,255,255,0.07); box-shadow: 0 4px 24px rgba(0,0,0,0.4); padding: 32px; max-width: 400px; width: 100%; }
    .card h2 { font-size: 20px; font-weight: 600; margin-bottom: 8px; text-align: center; color: #F9FAFB; }
    .card p { color: #9499a6; font-size: 14px; margin-bottom: 20px; text-align: center; }
    .client-name { color: #8B5CF6; font-weight: 600; }
    label { display: block; font-size: 14px; font-weight: 500; margin-bottom: 6px; color: #F9FAFB; }
    input[type="password"] { width: 100%; padding: 10px 12px; border: 0.5px solid rgba(255,255,255,0.07); border-radius: 8px; font-size: 14px; font-family: inherit; outline: none; transition: border-color 0.2s; color: #F9FAFB; background: #0a0c12; }
    input[type="password"]::placeholder { color: #6b7280; }
    input[type="password"]:focus { border-color: #8B5CF6; }
    .btn { display: block; width: 100%; padding: 12px; background: #8B5CF6; color: #fff; border: none; border-radius: 8px; font-size: 15px; font-weight: 600; font-family: inherit; cursor: pointer; margin-top: 16px; transition: background 0.2s; }
    .btn:hover { background: #7C3AED; }
    .btn:disabled { background: #aaa; cursor: not-allowed; }
    .signup { text-align: center; margin-top: 16px; font-size: 13px; color: #9499a6; }
    .signup a { color: #8B5CF6; text-decoration: none; }
    .signup a:hover { text-decoration: underline; }
    .error { background: rgba(220,38,38,0.1); border: 1px solid rgba(220,38,38,0.3); color: #fca5a5; padding: 10px 12px; border-radius: 8px; font-size: 13px; margin-bottom: 16px; }
    .scopes { background: #1e222d; border-radius: 8px; padding: 12px; margin-bottom: 16px; font-size: 13px; color: #9499a6; }
    .scopes strong { display: block; margin-bottom: 4px; color: #F9FAFB; }
    .bottom-glow { position: fixed; bottom: 0; left: 0; right: 0; height: 140px; background: linear-gradient(to top, rgba(139,92,246,0.13), transparent); pointer-events: none; }
  </style>
</head>
<body>
  <div class="header">
    <div class="brand">Open<span class="sos">SOS</span>Data</div>
  </div>
  <div class="container">
    <div class="card">
      <h2>Authorize Access</h2>
      <p>Allow <span class="client-name">${escapedClientName}</span> to access OpenSOSData on your behalf</p>
      ${escapedError}
      <div class="scopes">
        <strong>This application will be able to:</strong>
        Search business entities, check entity status, and search UCC filings using your API credits.
      </div>
      <form method="POST" action="/oauth/consent" id="consentForm">
        <input type="hidden" name="client_id" value="${escapeHtml(clientId)}" />
        <input type="hidden" name="code_challenge" value="${escapeHtml(params.codeChallenge)}" />
        <input type="hidden" name="redirect_uri" value="${escapeHtml(params.redirectUri)}" />
        <input type="hidden" name="state" value="${escapeHtml(params.state || '')}" />
        <input type="hidden" name="scopes" value="${escapeHtml((params.scopes || []).join(' '))}" />
        <input type="hidden" name="resource" value="${escapeHtml(params.resource?.toString() || '')}" />
        ${csrfToken ? `<input type="hidden" name="csrf_token" value="${escapeHtml(csrfToken)}" />` : ''}
        <label for="api_key">Your OpenSOSData API Key</label>
        <input type="password" id="api_key" name="api_key" placeholder="osd_..." required autocomplete="off" />
        <button type="submit" class="btn" id="submitBtn">Authorize</button>
      </form>
      <div class="signup">
        Don't have a key? <a href="https://opensosdata.com" target="_blank">Sign up at opensosdata.com</a>
      </div>
    </div>
  </div>
  <script>
    document.getElementById('consentForm').addEventListener('submit', function() {
      var btn = document.getElementById('submitBtn');
      btn.disabled = true;
      btn.textContent = 'Authorizing...';
    });
  </script>
  <div class="bottom-glow"></div>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
