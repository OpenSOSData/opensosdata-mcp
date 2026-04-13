import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { randomUUID } from 'crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from '@modelcontextprotocol/sdk/types.js';
import { toolDefinitions, handleToolCall } from './tools';

const PORT = parseInt(process.env.MCP_PORT || '3001', 10);

// Map of session transports for stateful mode
const transports = new Map<string, StreamableHTTPServerTransport>();

function createMcpServer(): Server {
  const server = new Server(
    { name: 'opensosdata', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: toolDefinitions
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      const result = await handleToolCall(name, args as Record<string, any>);
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
app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'opensosdata-mcp',
    version: '1.0.0',
    tools: toolDefinitions.length,
    uptime: process.uptime()
  });
});

// MCP discovery endpoint
app.get('/.well-known/mcp', (_req, res) => {
  res.json({
    name: 'opensosdata',
    version: '1.0.0',
    description: 'Search US business entity records across all 53 jurisdictions (50 states + DC + PR + USVI) in real time.',
    url: 'https://mcp.opensosdata.com/mcp',
    transport: 'streamable-http',
    capabilities: { tools: true },
    tools: toolDefinitions.map(t => ({ name: t.name, description: t.description })),
    documentation: 'https://opensosdata.com/mcp',
    pricing: { perLookup: '0.0314 USD', freeOnSignup: 10 },
    support: 'support@opensosdata.com'
  });
});

// MCP Streamable HTTP endpoint
app.post('/mcp', async (req, res) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;

  let transport: StreamableHTTPServerTransport;

  if (sessionId && transports.has(sessionId)) {
    // Reuse existing transport for this session
    transport = transports.get(sessionId)!;
  } else if (!sessionId) {
    // New session: create transport and server
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID()
    });
    const server = createMcpServer();
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
    if (sid) transports.set(sid, transport);
    return;
  } else {
    // Invalid session ID
    res.status(400).json({ error: 'Invalid or expired session' });
    return;
  }

  await transport.handleRequest(req, res, req.body);
});

// Handle GET for SSE streams (Streamable HTTP spec)
app.get('/mcp', async (req, res) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  if (!sessionId || !transports.has(sessionId)) {
    res.status(400).json({ error: 'Invalid or missing session ID' });
    return;
  }
  const transport = transports.get(sessionId)!;
  await transport.handleRequest(req, res);
});

// Handle DELETE for session cleanup
app.delete('/mcp', async (req, res) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  if (!sessionId || !transports.has(sessionId)) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  const transport = transports.get(sessionId)!;
  await transport.handleRequest(req, res);
  transports.delete(sessionId);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`OpenSOSData MCP server running on port ${PORT}`);
  console.log(`Health: http://localhost:${PORT}/health`);
  console.log(`MCP endpoint: http://localhost:${PORT}/mcp`);
  console.log(`Discovery: http://localhost:${PORT}/.well-known/mcp`);
});
