import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { Request, RequestHandler } from 'express';

import { toActError, type ActError } from '../actions/batch';
import type { ActionContext } from '../actions/define';
import { actionContextFromRequest } from '../actions/rest';
import { env as config } from '../config/env';
import { logger } from '../utils/logger';

import { AGENT_TOOLS, FailedResult, listAgentTools, type ToolEnv } from './agent-tools';

const INSTRUCTIONS =
  'Axiom holds issues, sprints and wiki pages. Use search to find things and read to open them ' +
  'by key. Use describe to see the actions your token allows, and act to run them. Use upload ' +
  'for files.';

/**
 * A tool answer as compact JSON text.
 * @param value - What the tool returned
 */
function toolResult(value: unknown) {
  const text = JSON.stringify(value === undefined ? { ok: true } : value);
  return { content: [{ type: 'text' as const, text }] };
}

/**
 * A refusal or failure as a tool answer.
 * @param error - What the caller may read
 */
function toolError(error: ActError) {
  return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify(error) }] };
}

/**
 * An MCP server for one request of one caller.
 * @param toolEnv - Who calls, and where the request came in
 */
export function createAgentServer(toolEnv: ToolEnv): Server {
  const server = new Server(
    { name: 'axiom', version: '0.2.0' },
    { capabilities: { tools: {} }, instructions: INSTRUCTIONS },
  );
  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: listAgentTools() }));
  server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
    const tool = AGENT_TOOLS.find((candidate) => candidate.name === params.name);
    if (!tool) {
      return toolError({
        status: 404,
        code: 'UNKNOWN_TOOL',
        message: `Unknown tool: ${params.name}`,
      });
    }
    try {
      const result = await tool.run(params.arguments ?? {}, toolEnv);
      if (result instanceof FailedResult) return { ...toolResult(result.value), isError: true };
      return toolResult(result);
    } catch (err) {
      return toolError(toActError(err));
    }
  });
  return server;
}

/**
 * Who runs the tools of this request.
 * @param req - A request authenticated with an API token (requireApiToken)
 */
function mcpContextFromRequest(req: Request): ActionContext {
  const ctx = actionContextFromRequest(req);
  return { ...ctx, channel: 'mcp', byName: { ipAddress: req.ip } };
}

/**
 * The origins a browser may call from: the configured site. With none configured, only this
 * machine, as CORS_ORIGIN's default of * says nothing about which site this is.
 */
function allowedOrigins(): Set<string> | undefined {
  const configured = [
    ...(config.CORS_ORIGIN === '*' ? [] : config.CORS_ORIGIN.split(',')),
    ...(process.env.FRONTEND_URL ? [process.env.FRONTEND_URL] : []),
  ];
  if (configured.length === 0) return undefined;
  return new Set(configured.map((origin) => normalizeOrigin(origin.trim())));
}

/**
 * An origin in the form to compare by, or the empty string when it isn't one.
 * @param origin - The header value or a configured URL
 */
function normalizeOrigin(origin: string): string {
  try {
    return new URL(origin).origin;
  } catch {
    return '';
  }
}

/**
 * Whether an Origin header may reach the endpoint.
 * @param origin - The header value
 */
function originAllowed(origin: string): boolean {
  const normalized = normalizeOrigin(origin);
  if (!normalized || normalized === 'null') return false;
  const allowed = allowedOrigins();
  if (allowed) return allowed.has(normalized);
  const { hostname } = new URL(normalized);
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

/**
 * The MCP spec's guard against DNS rebinding: a browser always sends Origin, an agent doesn't.
 * @param req - The request
 * @param res - The response
 * @param next - Continues to authentication
 */
export const checkMcpOrigin: RequestHandler = (req, res, next) => {
  const { origin } = req.headers;
  if (origin === undefined || originAllowed(origin)) {
    next();
    return;
  }
  res.status(403).json({ error: { message: 'Origin not allowed', code: 'INVALID_ORIGIN' } });
};

/**
 * /api/mcp takes API tokens only: a session's writes would carry no `via`, and an agent's work
 * would read as the person's own (R22).
 * @param req - An authenticated request
 * @param res - The response
 * @param next - Continues to the handler
 */
export const requireApiToken: RequestHandler = (req, res, next) => {
  if (req.apiTokenId !== undefined) {
    next();
    return;
  }
  res.status(401).json({
    error: {
      message:
        'The MCP endpoint takes API tokens. Create a token under Settings, API tokens, and send ' +
        'Authorization: Token <token>.',
      code: 'TOKEN_REQUIRED',
    },
  });
};

/**
 * Where a URL for this caller should point: the configured site, else where the request came in,
 * which reads forwarded headers when TRUST_PROXY allows them.
 * @param req - The request
 */
function publicOrigin(req: Request): string {
  const site = process.env.FRONTEND_URL ? normalizeOrigin(process.env.FRONTEND_URL) : '';
  return site || `${req.protocol}://${req.host ?? ''}`;
}

/**
 * A JSON-RPC error answered outside of any server.
 * @param message - The message
 */
function jsonRpcError(message: string) {
  return { jsonrpc: '2.0', error: { code: -32000, message }, id: null };
}

/**
 * GET and DELETE /api/mcp. Stateless, so there is no stream to open and no session to end. The SDK
 * would open a stream on GET in this mode, so the answer is given here.
 * @param _req - The request
 * @param res - The response
 */
export const refuseMcpStream: RequestHandler = (_req, res) => {
  res.status(405).set('Allow', 'POST').json(jsonRpcError('Method not allowed: use POST'));
};

/**
 * POST /api/mcp. One server and transport per request, closed with the response, so nothing stays
 * behind and every request authenticates anew. One message per request: a JSON-RPC batch would be
 * many tool calls behind one request of the rate limit, and the current MCP spec dropped them.
 * @param req - An authenticated request
 * @param res - The response
 */
export const handleMcpPost: RequestHandler = async (req, res) => {
  // Anything else skips the JSON parser and its limit: the transport would read the raw stream
  if (!req.is('application/json')) {
    res.status(415).json(jsonRpcError('Send Content-Type: application/json'));
    return;
  }
  const body: unknown = req.body;
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    res.status(400).json(jsonRpcError('Send one JSON-RPC message per request'));
    return;
  }
  const server = createAgentServer({
    ctx: mcpContextFromRequest(req),
    origin: publicOrigin(req),
  });
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  // Tool handlers answer their own failures, so -32603 only ever means the SDK refused the shape of
  // a request, and its message is a raw Zod dump
  const send = transport.send.bind(transport);
  transport.send = (message, options) =>
    send(
      'error' in message && message.error.code === ErrorCode.InternalError
        ? {
            ...message,
            error: { code: ErrorCode.InvalidParams, message: 'Invalid request parameters' },
          }
        : message,
      options,
    );
  res.on('close', () => {
    server.close().catch((err: unknown) => {
      logger.error('closing an MCP server failed', {}, err as Error);
    });
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
};
