import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { Request, Response } from 'express';

import { prisma } from '../config/database';

import { mcpContext } from './context';
import { registerIntegrationTools } from './tools/integration-tools';
import { registerIssueTools } from './tools/issue-tools';
import { registerOrgTools } from './tools/org-tools';
import { registerRepoTools } from './tools/repo-tools';
import { registerSearchTools } from './tools/search-tools';
import type { McpToolContext } from './tools/types';
import { registerWikiTools } from './tools/wiki-tools';

const connections = new Map<string, { transport: SSEServerTransport; userId: string }>();

function createMcpServer(userId: string) {
  const server = new McpServer({ name: 'axiom', version: '0.1.0' });

  async function getUserOrgIds() {
    const memberships = await prisma.orgMembership.findMany({
      where: { userId },
      select: { orgId: true },
    });
    return memberships.map((m) => m.orgId);
  }

  async function getOrgIdFromProject(projectId: string) {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: { team: { select: { orgId: true } } },
    });
    return project?.team?.orgId;
  }

  async function getOrgIdFromRepo(repoId: string) {
    const repo = await prisma.repository.findUnique({
      where: { id: repoId },
      include: { team: { select: { orgId: true } } },
    });
    return repo?.team?.orgId;
  }

  async function getOrgIdFromSprint(sprintId: string) {
    const sprint = await prisma.sprint.findUnique({
      where: { id: sprintId },
      include: { project: { include: { team: { select: { orgId: true } } } } },
    });
    return sprint?.project?.team?.orgId;
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
    getUserOrgIds,
    getOrgIdFromProject,
    getOrgIdFromRepo,
    getOrgIdFromSprint,
    getOrgIdFromPage,
  };

  registerOrgTools(ctx);
  registerIssueTools(ctx);
  registerWikiTools(ctx);
  registerRepoTools(ctx);
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
 *
 * @param req
 * @param res
 */
export async function handleMcpMessage(req: Request, res: Response) {
  const sessionId = req.query.session as string;
  const conn = sessionId ? connections.get(sessionId) : connections.values().next().value;
  if (!conn) {
    res.status(400).json({ error: 'No active SSE connection' });
    return;
  }

  const userId = (req as Request & { userId?: string }).userId ?? conn.userId;
  await mcpContext.run({ userId }, async () => {
    await conn.transport.handlePostMessage(req, res);
  });
}
