import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { randomUUID } from 'crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from '@modelcontextprotocol/sdk/types.js';
import { mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { toolDefinitions, handleToolCall } from './tools';
import { OpenSOSDataOAuthProvider, handleConsentSubmit } from './oauth-provider';
import { cleanupExpired } from './oauth-store';

const pkg = require('../package.json');
const PORT = parseInt(process.env.MCP_PORT || '3001', 10);
const ISSUER_URL = new URL(process.env.MCP_ISSUER_URL || `http://localhost:${PORT}`);

// --- OAuth provider ---
const oauthProvider = new OpenSOSDataOAuthProvider();

// Map of session transports for stateful mode (with TTL tracking)
const transports = new Map<string, { transport: StreamableHTTPServerTransport; lastActive: number; apiKey: string }>();

// Session cleanup: evict sessions idle for more than 30 minutes
const SESSION_TTL_MS = 30 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [sid, entry] of transports) {
    if (now - entry.lastActive > SESSION_TTL_MS) {
      console.log(`Evicting idle session: ${sid} (idle ${Math.round((now - entry.lastActive) / 1000)}s)`);
      try {
        entry.transport.close?.();
      } catch (_) {}
      transports.delete(sid);
    }
  }
}, CLEANUP_INTERVAL_MS);

// Periodic cleanup of expired OAuth tokens (every 15 minutes)
setInterval(() => {
  try {
    const deleted = cleanupExpired();
    if (deleted > 0) console.log(`OAuth cleanup: removed ${deleted} expired records`);
  } catch (err) {
    console.error('OAuth cleanup error:', err);
  }
}, 15 * 60 * 1000);

function createMcpServer(apiKey: string): Server {
  const server = new Server(
    { name: 'opensosdata', version: pkg.version },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: toolDefinitions
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      const result = await handleToolCall(name, args as Record<string, any>, apiKey);
      return {
        content: [{ type: 'text' as const, text: result.text }],
        isError: result.isError
      };
    } catch (err: any) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${err.message}` }],
        isError: true
      };
    }
  });

  return server;
}

const app = express();
app.set('trust proxy', 1);
app.use(cors());

// --- Mount OAuth auth router (MUST be at application root, before other routes) ---
app.use(mcpAuthRouter({
  provider: oauthProvider,
  issuerUrl: ISSUER_URL,
  scopesSupported: ['opensosdata'],
  serviceDocumentationUrl: new URL('https://opensosdata.com/mcp'),
  resourceName: 'OpenSOSData MCP Server',
}));

// Parse JSON/URL-encoded for remaining routes
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate limiter for /oauth/consent endpoint (strict: 10 requests per minute per IP)
const consentRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please wait and try again.' },
  validate: { xForwardedForHeader: false }
});

// --- OAuth consent form POST handler ---
app.post('/oauth/consent', consentRateLimiter, async (req, res) => {
  const { client_id, code_challenge, redirect_uri, state, scopes, resource, api_key, csrf_token } = req.body;
  if (!client_id || !code_challenge || !redirect_uri || !api_key) {
    res.status(400).json({ error: 'Missing required fields' });
    return;
  }
  const scopeList = scopes ? (scopes as string).split(' ').filter(Boolean) : [];
  await handleConsentSubmit(
    client_id,
    code_challenge,
    redirect_uri,
    state || undefined,
    scopeList,
    resource || undefined,
    api_key,
    csrf_token || undefined,
    res
  );
});

// Rate limiter for /mcp endpoint only
const mcpRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Rate limit exceeded. Please retry after 60 seconds.' },
  validate: { xForwardedForHeader: false }
});

// Health check (unauthenticated)
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'opensosdata-mcp',
    version: pkg.version,
    tools: toolDefinitions.length,
    uptime: process.uptime()
  });
});

// MCP discovery endpoint
app.get('/.well-known/mcp', (_req, res) => {
  res.json({
    name: 'opensosdata',
    version: pkg.version,
    description: 'Search US business entity records across all 53 jurisdictions (50 states + DC + PR + USVI) in real time.',
    url: `${ISSUER_URL.origin}/mcp`,
    transport: 'streamable-http',
    capabilities: { tools: true },
    authentication: {
      type: 'oauth2',
      authorization_server: `${ISSUER_URL.origin}/.well-known/oauth-authorization-server`,
    },
    tools: toolDefinitions.map(t => ({ name: t.name, description: t.description })),
    documentation: 'https://opensosdata.com/mcp',
    pricing: { perLookup: '0.0314 USD', freeOnSignup: 10 },
    support: 'support@opensosdata.com'
  });
});

// --- Bearer auth middleware for /mcp ---
const bearerAuth = requireBearerAuth({
  verifier: oauthProvider,
  resourceMetadataUrl: `${ISSUER_URL.origin}/.well-known/oauth-protected-resource`,
});

// MCP Streamable HTTP endpoint (rate limited + authenticated)
app.post('/mcp', mcpRateLimiter, bearerAuth, async (req, res) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  const apiKey = (req.auth?.extra?.apiKey as string) || '';

  let transport: StreamableHTTPServerTransport;

  if (sessionId && transports.has(sessionId)) {
    // Reuse existing transport for this session
    const entry = transports.get(sessionId)!;
    entry.lastActive = Date.now();
    transport = entry.transport;
  } else if (!sessionId) {
    // New session: create transport and server
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID()
    });
    const server = createMcpServer(apiKey);
    await server.connect(transport);

    // Store the transport once we know its session ID
    transport.onclose = () => {
      const sid = transport.sessionId;
      if (sid) transports.delete(sid);
    };

    // We need to handle the request to get the session ID assigned
    await transport.handleRequest(req, res, req.body);

    // After handling, store the transport with its assigned session ID
    const sid = transport.sessionId;
    if (sid) transports.set(sid, { transport, lastActive: Date.now(), apiKey });
    return;
  } else {
    // Invalid session ID
    res.status(400).json({ error: 'Invalid or expired session' });
    return;
  }

  await transport.handleRequest(req, res, req.body);
});

// Handle GET for SSE streams (Streamable HTTP spec) — also protected
app.get('/mcp', mcpRateLimiter, bearerAuth, async (req, res) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  if (!sessionId || !transports.has(sessionId)) {
    res.status(400).json({ error: 'Invalid or missing session ID' });
    return;
  }
  const entry = transports.get(sessionId)!;
  entry.lastActive = Date.now();
  await entry.transport.handleRequest(req, res);
});

// Handle DELETE for session cleanup — also protected
app.delete('/mcp', bearerAuth, async (req, res) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  if (!sessionId || !transports.has(sessionId)) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  const entry = transports.get(sessionId)!;
  await entry.transport.handleRequest(req, res);
  transports.delete(sessionId);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`OpenSOSData MCP server v${pkg.version} running on port ${PORT}`);
  console.log(`Issuer URL: ${ISSUER_URL.toString()}`);
  console.log(`Health: http://localhost:${PORT}/health`);
  console.log(`MCP endpoint: http://localhost:${PORT}/mcp`);
  console.log(`Discovery: http://localhost:${PORT}/.well-known/mcp`);
  console.log(`OAuth metadata: http://localhost:${PORT}/.well-known/oauth-authorization-server`);
});
