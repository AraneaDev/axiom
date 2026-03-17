import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../config/database';
import * as gitCmd from '../git/git-commands';
import { repoExists } from '../git/repo-manager';
import { mcpContext } from './context';
import { assertMcpPermission } from './mcp-permissions';

const connections = new Map<string, { transport: SSEServerTransport; userId: string }>();

function createMcpServer(userId: string) {
  const server = new McpServer({ name: 'axiom', version: '0.1.0' });

  // Helper to get current user's org IDs
  async function getUserOrgIds() {
    const memberships = await prisma.orgMembership.findMany({ where: { userId }, select: { orgId: true } });
    return memberships.map(m => m.orgId);
  }

  // Helper to get org ID from project ID
  async function getOrgIdFromProject(projectId: string) {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: { team: { select: { orgId: true } } },
    });
    return project?.team?.orgId;
  }

  // ─── Org/Team Tools ─────────────────────────────────────────

  server.tool('list_orgs', 'List organizations the current user belongs to', {},
    async () => {
      const memberships = await prisma.orgMembership.findMany({
        where: { userId },
        include: { org: true },
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(memberships.map(m => ({ ...m.org, role: m.role })), null, 2) }] };
    }
  );

  server.tool('list_teams', 'List teams in an organization the user is a member of',
    { orgId: z.string().describe('Organization ID') },
    async ({ orgId }) => {
      await assertMcpPermission('list_teams', orgId);
      const memberships = await prisma.teamMembership.findMany({
        where: { userId, team: { orgId } },
        include: { team: { include: { _count: { select: { members: true, repos: true, projects: true, wikiSpaces: true } } } } },
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(memberships.map(m => m.team), null, 2) }] };
    }
  );

  server.tool('list_projects', 'List projects in a team',
    { teamId: z.string().describe('Team ID') },
    async ({ teamId }) => {
      const team = await prisma.team.findUnique({ where: { id: teamId } });
      if (!team) return { content: [{ type: 'text' as const, text: 'Team not found' }] };
      await assertMcpPermission('list_projects', team.orgId);
      const projects = await prisma.project.findMany({
        where: { teamId },
        include: { _count: { select: { issues: true } } },
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(projects, null, 2) }] };
    }
  );

  // ─── Issues Tools ───────────────────────────────────────────

  server.tool('list_issues', 'List issues in a project, optionally filtered by type, priority, or assignee',
    {
      projectId: z.string().describe('Project ID'),
      type: z.enum(['TASK', 'BUG', 'STORY', 'EPIC']).optional(),
      priority: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']).optional(),
      assigneeId: z.string().optional(),
      limit: z.number().default(20),
    },
    async ({ projectId, type, priority, assigneeId, limit }) => {
      const orgId = await getOrgIdFromProject(projectId);
      if (!orgId) return { content: [{ type: 'text' as const, text: 'Project not found' }] };
      await assertMcpPermission('list_issues', orgId);
      const where: Record<string, unknown> = { projectId };
      if (type) where.type = type;
      if (priority) where.priority = priority;
      if (assigneeId) where.assigneeId = assigneeId;
      const issues = await prisma.issue.findMany({
        where,
        include: {
          project: { select: { prefix: true } },
          assignee: { select: { id: true, username: true, displayName: true } },
          labels: true,
          column: { select: { name: true } },
        },
        take: limit,
        orderBy: { updatedAt: 'desc' },
      });
      const result = issues.map(i => ({
        key: `${i.project.prefix}-${i.number}`,
        title: i.title, type: i.type, priority: i.priority,
        status: i.column?.name ?? 'Unassigned',
        assignee: i.assignee?.displayName ?? 'Unassigned',
        labels: i.labels.map(l => l.name),
      }));
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool('get_issue', 'Get full details of a specific issue by project ID and issue number',
    { projectId: z.string(), issueNumber: z.number() },
    async ({ projectId, issueNumber }) => {
      const orgId = await getOrgIdFromProject(projectId);
      if (!orgId) return { content: [{ type: 'text' as const, text: 'Project not found' }] };
      await assertMcpPermission('get_issue', orgId);
      const project = await prisma.project.findUnique({ where: { id: projectId } });
      if (!project) return { content: [{ type: 'text' as const, text: 'Project not found' }] };
      const issue = await prisma.issue.findUnique({
        where: { projectId_number: { projectId, number: issueNumber } },
        include: {
          assignee: { select: { id: true, username: true, displayName: true } },
          creator: { select: { id: true, username: true, displayName: true } },
          labels: true, column: true,
          comments: { include: { author: { select: { username: true, displayName: true } } }, orderBy: { createdAt: 'asc' } },
        },
      });
      if (!issue) return { content: [{ type: 'text' as const, text: 'Issue not found' }] };
      return { content: [{ type: 'text' as const, text: JSON.stringify({ ...issue, key: `${project.prefix}-${issue.number}` }, null, 2) }] };
    }
  );

  server.tool('create_issue', 'Create a new issue in a project',
    {
      projectId: z.string(),
      title: z.string(),
      body: z.string().default(''),
      type: z.enum(['TASK', 'BUG', 'STORY', 'EPIC']).default('TASK'),
      priority: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']).default('MEDIUM'),
      assigneeId: z.string().optional(),
    },
    async ({ projectId, title, body, type, priority, assigneeId }) => {
      const orgId = await getOrgIdFromProject(projectId);
      if (!orgId) return { content: [{ type: 'text' as const, text: 'Project not found' }] };
      await assertMcpPermission('create_issue', orgId);
      const project = await prisma.project.findUnique({ where: { id: projectId } });
      if (!project) return { content: [{ type: 'text' as const, text: 'Project not found' }] };
      const lastIssue = await prisma.issue.findFirst({ where: { projectId }, orderBy: { number: 'desc' }, select: { number: true } });
      const number = (lastIssue?.number ?? 0) + 1;
      const defaultColumn = await prisma.boardColumn.findFirst({ where: { projectId, isDefault: true } });
      const issue = await prisma.issue.create({
        data: { projectId, number, title, body, type, priority, assigneeId, creatorId: userId, columnId: defaultColumn?.id },
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify({ key: `${project.prefix}-${number}`, id: issue.id, title }, null, 2) }] };
    }
  );

  server.tool('add_comment', 'Add a comment to an issue',
    { projectId: z.string(), issueNumber: z.number(), body: z.string() },
    async ({ projectId, issueNumber, body }) => {
      const orgId = await getOrgIdFromProject(projectId);
      if (!orgId) return { content: [{ type: 'text' as const, text: 'Project not found' }] };
      await assertMcpPermission('add_comment', orgId);
      const issue = await prisma.issue.findUnique({ where: { projectId_number: { projectId, number: issueNumber } } });
      if (!issue) return { content: [{ type: 'text' as const, text: 'Issue not found' }] };
      const comment = await prisma.comment.create({ data: { issueId: issue.id, authorId: userId, body } });
      return { content: [{ type: 'text' as const, text: JSON.stringify(comment, null, 2) }] };
    }
  );

  // ─── Wiki Tools ─────────────────────────────────────────────

  server.tool('list_wiki_spaces', 'List wiki spaces for a team',
    { teamId: z.string() },
    async ({ teamId }) => {
      const team = await prisma.team.findUnique({ where: { id: teamId } });
      if (!team) return { content: [{ type: 'text' as const, text: 'Team not found' }] };
      await assertMcpPermission('list_wiki_spaces', team.orgId);
      const spaces = await prisma.wikiSpace.findMany({ where: { teamId }, include: { _count: { select: { pages: true } } } });
      return { content: [{ type: 'text' as const, text: JSON.stringify(spaces, null, 2) }] };
    }
  );

  server.tool('get_wiki_page', 'Get a wiki page by space ID and page slug',
    { spaceId: z.string(), pageSlug: z.string() },
    async ({ spaceId, pageSlug }) => {
      const space = await prisma.wikiSpace.findUnique({ where: { id: spaceId } });
      if (!space) return { content: [{ type: 'text' as const, text: 'Space not found' }] };
      const team = await prisma.team.findUnique({ where: { id: space.teamId } });
      if (team) await assertMcpPermission('get_wiki_page', team.orgId);
      const page = await prisma.page.findUnique({
        where: { spaceId_slug: { spaceId, slug: pageSlug } },
        include: { children: { select: { title: true, slug: true } } },
      });
      if (!page) return { content: [{ type: 'text' as const, text: 'Page not found' }] };
      return { content: [{ type: 'text' as const, text: JSON.stringify(page, null, 2) }] };
    }
  );

  server.tool('create_wiki_page', 'Create a new wiki page',
    { spaceId: z.string(), title: z.string(), slug: z.string(), body: z.string().default(''), parentId: z.string().optional() },
    async ({ spaceId, title, slug, body, parentId }) => {
      const space = await prisma.wikiSpace.findUnique({ where: { id: spaceId } });
      if (!space) return { content: [{ type: 'text' as const, text: 'Space not found' }] };
      const team = await prisma.team.findUnique({ where: { id: space.teamId } });
      if (team) await assertMcpPermission('create_wiki_page', team.orgId);
      const existing = await prisma.page.findUnique({ where: { spaceId_slug: { spaceId, slug } } });
      if (existing) return { content: [{ type: 'text' as const, text: 'Page slug already exists' }] };
      const page = await prisma.page.create({
        data: { spaceId, title, slug, body, parentId, versions: { create: { version: 1, title, body, authorId: userId } } },
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(page, null, 2) }] };
    }
  );

  server.tool('get_page_tree', 'Get the full page tree structure of a wiki space',
    { spaceId: z.string() },
    async ({ spaceId }) => {
      const space = await prisma.wikiSpace.findUnique({ where: { id: spaceId } });
      if (!space) return { content: [{ type: 'text' as const, text: 'Space not found' }] };
      const team = await prisma.team.findUnique({ where: { id: space.teamId } });
      if (team) await assertMcpPermission('get_page_tree', team.orgId);
      const pages = await prisma.page.findMany({
        where: { spaceId },
        select: { id: true, title: true, slug: true, parentId: true, position: true },
        orderBy: { position: 'asc' },
      });
      const map = new Map<string | null, typeof pages>();
      for (const page of pages) {
        const key = page.parentId ?? null;
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(page);
      }
      function buildTree(parentId: string | null): unknown[] {
        return (map.get(parentId) ?? []).map(p => ({ ...p, children: buildTree(p.id) }));
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(buildTree(null), null, 2) }] };
    }
  );

  // ─── Git / Repos Tools ─────────────────────────────────────

  server.tool('list_repos', 'List repositories in a team',
    { teamId: z.string() },
    async ({ teamId }) => {
      const team = await prisma.team.findUnique({ where: { id: teamId } });
      if (!team) return { content: [{ type: 'text' as const, text: 'Team not found' }] };
      await assertMcpPermission('list_repos', team.orgId);
      const repos = await prisma.repository.findMany({
        where: { teamId },
        select: { id: true, name: true, slug: true, description: true, visibility: true, defaultBranch: true },
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(repos, null, 2) }] };
    }
  );

  server.tool('browse_files', 'List files and directories in a repository at a given path and ref',
    { repoId: z.string(), ref: z.string().default('HEAD'), path: z.string().default('') },
    async ({ repoId, ref, path }) => {
      const repo = await prisma.repository.findUnique({ where: { id: repoId }, include: { team: true } });
      if (!repo?.diskPath || !await repoExists(repo.diskPath)) return { content: [{ type: 'text' as const, text: 'Repository not found' }] };
      await assertMcpPermission('browse_files', repo.team.orgId);
      const entries = await gitCmd.lsTree(repo.diskPath, ref, path);
      return { content: [{ type: 'text' as const, text: JSON.stringify(entries, null, 2) }] };
    }
  );

  server.tool('read_file', 'Read the content of a file in a repository at a given ref',
    { repoId: z.string(), ref: z.string().default('HEAD'), filePath: z.string() },
    async ({ repoId, ref, filePath }) => {
      const repo = await prisma.repository.findUnique({ where: { id: repoId }, include: { team: true } });
      if (!repo?.diskPath || !await repoExists(repo.diskPath)) return { content: [{ type: 'text' as const, text: 'Repository not found' }] };
      await assertMcpPermission('read_file', repo.team.orgId);
      try {
        const content = await gitCmd.showBlob(repo.diskPath, ref, filePath);
        return { content: [{ type: 'text' as const, text: content }] };
      } catch {
        return { content: [{ type: 'text' as const, text: `File not found: ${filePath}` }] };
      }
    }
  );

  server.tool('get_commits', 'Get recent commits on a branch or ref in a repository',
    { repoId: z.string(), ref: z.string().default('HEAD'), limit: z.number().default(10) },
    async ({ repoId, ref, limit }) => {
      const repo = await prisma.repository.findUnique({ where: { id: repoId }, include: { team: true } });
      if (!repo?.diskPath || !await repoExists(repo.diskPath)) return { content: [{ type: 'text' as const, text: 'Repository not found' }] };
      await assertMcpPermission('get_commits', repo.team.orgId);
      const commits = await gitCmd.log(repo.diskPath, ref, limit);
      return { content: [{ type: 'text' as const, text: JSON.stringify(commits, null, 2) }] };
    }
  );

  server.tool('get_branches', 'List all branches in a repository',
    { repoId: z.string() },
    async ({ repoId }) => {
      const repo = await prisma.repository.findUnique({ where: { id: repoId }, include: { team: true } });
      if (!repo?.diskPath || !await repoExists(repo.diskPath)) return { content: [{ type: 'text' as const, text: 'Repository not found' }] };
      await assertMcpPermission('get_branches', repo.team.orgId);
      const branches = await gitCmd.listBranches(repo.diskPath, repo.defaultBranch);
      return { content: [{ type: 'text' as const, text: JSON.stringify(branches, null, 2) }] };
    }
  );

  server.tool('get_diff', 'Get the diff between two refs in a repository',
    { repoId: z.string(), base: z.string(), head: z.string() },
    async ({ repoId, base, head }) => {
      const repo = await prisma.repository.findUnique({ where: { id: repoId }, include: { team: true } });
      if (!repo?.diskPath || !await repoExists(repo.diskPath)) return { content: [{ type: 'text' as const, text: 'Repository not found' }] };
      await assertMcpPermission('get_diff', repo.team.orgId);
      const diffOutput = await gitCmd.diff(repo.diskPath, base, head);
      const stats = await gitCmd.diffStat(repo.diskPath, base, head);
      return { content: [{ type: 'text' as const, text: JSON.stringify({ diff: diffOutput, stats }, null, 2) }] };
    }
  );

  server.tool('list_pull_requests', 'List pull requests in a repository, optionally filtered by status',
    { repoId: z.string(), status: z.enum(['OPEN', 'MERGED', 'CLOSED']).optional() },
    async ({ repoId, status }) => {
      const repo = await prisma.repository.findUnique({ where: { id: repoId }, include: { team: true } });
      if (!repo) return { content: [{ type: 'text' as const, text: 'Repository not found' }] };
      await assertMcpPermission('list_pull_requests', repo.team.orgId);
      const where: Record<string, unknown> = { repoId };
      if (status) where.status = status;
      const prs = await prisma.pullRequest.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        select: { number: true, title: true, status: true, sourceBranch: true, targetBranch: true, authorId: true, createdAt: true, updatedAt: true, _count: { select: { reviews: true, comments: true } } },
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(prs, null, 2) }] };
    }
  );

  // ─── Search Tool ────────────────────────────────────────────

  server.tool('search', 'Search across issues and wiki pages',
    { query: z.string(), type: z.enum(['issues', 'wiki', 'all']).default('all'), limit: z.number().default(10) },
    async ({ query, type, limit }) => {
      const results: unknown[] = [];
      if (type === 'issues' || type === 'all') {
        const orgIds = await getUserOrgIds();
        const issues = await prisma.issue.findMany({
          where: {
            OR: [{ title: { contains: query, mode: 'insensitive' } }, { body: { contains: query, mode: 'insensitive' } }],
            project: { team: { orgId: { in: orgIds } } },
          },
          include: { project: { select: { prefix: true } } },
          take: limit, orderBy: { updatedAt: 'desc' },
        });
        results.push(...issues.map(i => ({ type: 'issue', key: `${i.project.prefix}-${i.number}`, title: i.title, priority: i.priority, issueType: i.type })));
      }
      if (type === 'wiki' || type === 'all') {
        const orgIds = await getUserOrgIds();
        const pages = await prisma.page.findMany({
          where: {
            OR: [{ title: { contains: query, mode: 'insensitive' } }, { body: { contains: query, mode: 'insensitive' } }],
            space: { team: { orgId: { in: orgIds } } },
          },
          include: { space: { select: { name: true, slug: true } } },
          take: limit, orderBy: { updatedAt: 'desc' },
        });
        results.push(...pages.map(p => ({ type: 'wiki', space: p.space.name, title: p.title, slug: p.slug })));
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] };
    }
  );

  return server;
}

// SSE transport handler for Express
export async function handleMcpSse(req: Request, res: Response) {
  const userId = (req as Request & { userId?: string }).userId;
  if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }

  const id = crypto.randomUUID();
  const server = createMcpServer(userId);
  const transport = new SSEServerTransport(`/api/mcp/messages?session=${id}`, res);
  connections.set(id, { transport, userId });

  res.on('close', () => { connections.delete(id); });

  await mcpContext.run({ userId }, async () => {
    await server.connect(transport);
  });
}

export async function handleMcpMessage(req: Request, res: Response) {
  const sessionId = req.query.session as string;
  const conn = sessionId ? connections.get(sessionId) : connections.values().next().value;
  if (!conn) { res.status(400).json({ error: 'No active SSE connection' }); return; }

  const userId = (req as Request & { userId?: string }).userId ?? conn.userId;
  await mcpContext.run({ userId }, async () => {
    await conn.transport.handlePostMessage(req, res);
  });
}
