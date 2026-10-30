import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { Request, Response } from 'express';

import { prisma } from '../config/database';

import { mcpContext } from './context';
import { registerIntegrationTools } from './tools/integration-tools';
import { registerIssueTools } from './tools/issue-tools';
import { registerOrgTools } from './tools/org-tools';
import { registerSearchTools } from './tools/search-tools';
import type { McpToolContext } from './tools/types';
import { registerWikiTools } from './tools/wiki-tools';

const connections = new Map<string, { transport: SSEServerTransport; userId: string }>();

/**
 * Build an MCP server with all tools registered for the given user.
 * @param userId
 */
export function createMcpServer(userId: string) {
  const server = new McpServer({ name: 'axiom', version: '0.1.0' });

  async function getOrgIdFromProject(projectId: string) {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: { team: { select: { orgId: true } } },
    });
    return project?.team?.orgId;
  }

  async function getOrgIdFromPage(pageId: string) {
    const page = await prisma.page.findUnique({
      where: { id: pageId },
      include: { space: { include: { team: { select: { orgId: true } } } } },
    });
    return page?.space?.team?.orgId;
  }

  const ctx: McpToolContext = {
    server,
    userId,
    getOrgIdFromProject,
    getOrgIdFromPage,
  };

  registerOrgTools(ctx);
  registerIssueTools(ctx);
  registerWikiTools(ctx);
  registerSearchTools(ctx);
  registerIntegrationTools(ctx);

  return server;
}

// SSE transport handler for Express
/**
 *
 * @param req
 * @param res
 */
export async function handleMcpSse(req: Request, res: Response) {
  const userId = (req as Request & { userId?: string }).userId;
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const id = crypto.randomUUID();
  const server = createMcpServer(userId);
  const transport = new SSEServerTransport(`/api/mcp/messages?session=${id}`, res);
  connections.set(id, { transport, userId });

  res.on('close', () => {
    connections.delete(id);
  });

  await mcpContext.run({ userId }, async () => {
    await server.connect(transport);
  });
}

/**
 * Route a JSON-RPC message to the caller's own SSE session.
 * @param req
 * @param res
 */
export async function handleMcpMessage(req: Request, res: Response) {
  const userId = (req as Request & { userId?: string }).userId;
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  // A message must name its session, and only the session's owner may post to it: tools
  // act as the user the server was built for
  const sessionId = typeof req.query.session === 'string' ? req.query.session : '';
  if (!sessionId) {
    res.status(400).json({ error: 'Missing session' });
    return;
  }
  const conn = connections.get(sessionId);
  if (!conn) {
    res.status(400).json({ error: 'No active SSE connection' });
    return;
  }
  if (conn.userId !== userId) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  await mcpContext.run({ userId }, async () => {
    await conn.transport.handlePostMessage(req, res);
  });
}
