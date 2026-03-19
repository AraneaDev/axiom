import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { Request, Response } from 'express';
import { z } from 'zod';

import { prisma } from '../config/database';
import * as gitCmd from '../git/git-commands';
import { repoExists } from '../git/repo-manager';
import * as issuesService from '../modules/issues/issues.service';
import * as pipelinesService from '../modules/pipelines/pipelines.service';
import * as pullsService from '../modules/pulls/pulls.service';
import * as releasesService from '../modules/releases/releases.service';
import * as sprintsService from '../modules/sprints/sprints.service';
import * as wikiService from '../modules/wiki/wiki.service';
import { USER_BASIC_SELECT } from '../utils/prisma-selects';

import { mcpContext } from './context';
import { assertMcpPermission } from './mcp-permissions';

const connections = new Map<string, { transport: SSEServerTransport; userId: string }>();

function createMcpServer(userId: string) {
  const server = new McpServer({ name: 'axiom', version: '0.1.0' });

  // Helper to get current user's org IDs
  async function getUserOrgIds() {
    const memberships = await prisma.orgMembership.findMany({
      where: { userId },
      select: { orgId: true },
    });
    return memberships.map((m) => m.orgId);
  }

  // Helper to get org ID from project ID
  async function getOrgIdFromProject(projectId: string) {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: { team: { select: { orgId: true } } },
    });
    return project?.team?.orgId;
  }

  // Helper to get org ID from repo ID
  async function getOrgIdFromRepo(repoId: string) {
    const repo = await prisma.repository.findUnique({
      where: { id: repoId },
      include: { team: { select: { orgId: true } } },
    });
    return repo?.team?.orgId;
  }

  // Helper to get org ID from sprint ID
  async function getOrgIdFromSprint(sprintId: string) {
    const sprint = await prisma.sprint.findUnique({
      where: { id: sprintId },
      include: { project: { include: { team: { select: { orgId: true } } } } },
    });
    return sprint?.project?.team?.orgId;
  }

  // ─── Org/Team Tools ─────────────────────────────────────────

  server.tool(
    'list_orgs',
    'List organizations the current user belongs to',
    {
      cursor: z.string().optional().describe('Cursor for pagination (org ID to start after)'),
      limit: z.number().optional().default(20).describe('Max results to return'),
    },
    async ({ cursor, limit }) => {
      const take = Math.min(limit, 100);
      const memberships = await prisma.orgMembership.findMany({
        where: { userId },
        include: { org: true },
        orderBy: { orgId: 'asc' },
        take: take + 1,
        ...(cursor ? { cursor: { userId_orgId: { userId, orgId: cursor } }, skip: 1 } : {}),
      });
      const hasMore = memberships.length > take;
      const page = hasMore ? memberships.slice(0, take) : memberships;
      const result: Record<string, unknown> = {
        data: page.map((m) => ({ ...m.org, role: m.role })),
      };
      if (hasMore) result.next_cursor = page[page.length - 1].orgId;
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    'list_teams',
    'List teams in an organization the user is a member of',
    {
      orgId: z.string().describe('Organization ID'),
      cursor: z.string().optional().describe('Cursor for pagination (team ID to start after)'),
      limit: z.number().optional().default(20).describe('Max results to return'),
    },
    async ({ orgId, cursor, limit }) => {
      await assertMcpPermission('list_teams', orgId);
      const take = Math.min(limit, 100);
      const teams = await prisma.team.findMany({
        where: { orgId, members: { some: { userId } } },
        include: {
          _count: { select: { members: true, repos: true, projects: true, wikiSpaces: true } },
        },
        orderBy: { id: 'asc' },
        take: take + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      const hasMore = teams.length > take;
      const page = hasMore ? teams.slice(0, take) : teams;
      const result: Record<string, unknown> = { data: page };
      if (hasMore) result.next_cursor = page[page.length - 1].id;
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    'list_projects',
    'List projects in a team',
    {
      teamId: z.string().describe('Team ID'),
      cursor: z.string().optional().describe('Cursor for pagination (project ID to start after)'),
      limit: z.number().optional().default(20).describe('Max results to return'),
    },
    async ({ teamId, cursor, limit }) => {
      const team = await prisma.team.findUnique({ where: { id: teamId } });
      if (!team) return { content: [{ type: 'text' as const, text: 'Team not found' }] };
      await assertMcpPermission('list_projects', team.orgId);
      const take = Math.min(limit, 100);
      const projects = await prisma.project.findMany({
        where: { teamId },
        include: { _count: { select: { issues: true } } },
        orderBy: { id: 'asc' },
        take: take + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      const hasMore = projects.length > take;
      const page = hasMore ? projects.slice(0, take) : projects;
      const result: Record<string, unknown> = { data: page };
      if (hasMore) result.next_cursor = page[page.length - 1].id;
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  // ─── Issues Tools ───────────────────────────────────────────

  server.tool(
    'list_issues',
    'List issues in a project, optionally filtered by type, priority, or assignee',
    {
      projectId: z.string().describe('Project ID'),
      type: z.enum(['TASK', 'BUG', 'STORY', 'EPIC']).optional(),
      priority: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']).optional(),
      assigneeId: z.string().optional(),
      cursor: z.string().optional().describe('Cursor for pagination (issue ID to start after)'),
      limit: z.number().optional().default(20).describe('Max results to return'),
    },
    async ({ projectId, type, priority, assigneeId, cursor, limit }) => {
      const orgId = await getOrgIdFromProject(projectId);
      if (!orgId) return { content: [{ type: 'text' as const, text: 'Project not found' }] };
      await assertMcpPermission('list_issues', orgId);
      const where: Record<string, unknown> = { projectId };
      if (type) where.type = type;
      if (priority) where.priority = priority;
      if (assigneeId) where.assigneeId = assigneeId;
      const take = Math.min(limit, 100);
      const issues = await prisma.issue.findMany({
        where,
        include: {
          project: { select: { prefix: true } },
          assignee: { select: USER_BASIC_SELECT },
          labels: true,
          column: { select: { name: true } },
        },
        take: take + 1,
        orderBy: { updatedAt: 'desc' },
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      const hasMore = issues.length > take;
      const page = hasMore ? issues.slice(0, take) : issues;
      const data = page.map((i) => ({
        id: i.id,
        key: `${i.project.prefix}-${i.number}`,
        title: i.title,
        type: i.type,
        priority: i.priority,
        status: i.column?.name ?? 'Unassigned',
        assignee: i.assignee?.displayName ?? 'Unassigned',
        labels: i.labels.map((l) => l.name),
      }));
      const result: Record<string, unknown> = { data };
      if (hasMore) result.next_cursor = page[page.length - 1].id;
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    'get_issue',
    'Get full details of a specific issue by project ID and issue number',
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
          assignee: { select: USER_BASIC_SELECT },
          creator: { select: USER_BASIC_SELECT },
          labels: true,
          column: true,
          comments: {
            include: { author: { select: { username: true, displayName: true } } },
            orderBy: { createdAt: 'asc' },
          },
        },
      });
      if (!issue) return { content: [{ type: 'text' as const, text: 'Issue not found' }] };
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ ...issue, key: `${project.prefix}-${issue.number}` }, null, 2),
          },
        ],
      };
    },
  );

  server.tool(
    'create_issue',
    'Create a new issue in a project',
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
      const lastIssue = await prisma.issue.findFirst({
        where: { projectId },
        orderBy: { number: 'desc' },
        select: { number: true },
      });
      const number = (lastIssue?.number ?? 0) + 1;
      const defaultColumn = await prisma.boardColumn.findFirst({
        where: { projectId, isDefault: true },
      });
      const issue = await prisma.issue.create({
        data: {
          projectId,
          number,
          title,
          body,
          type,
          priority,
          assigneeId,
          creatorId: userId,
          columnId: defaultColumn?.id,
        },
      });
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              { key: `${project.prefix}-${number}`, id: issue.id, title },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.tool(
    'add_comment',
    'Add a comment to an issue',
    { projectId: z.string(), issueNumber: z.number(), body: z.string() },
    async ({ projectId, issueNumber, body }) => {
      const orgId = await getOrgIdFromProject(projectId);
      if (!orgId) return { content: [{ type: 'text' as const, text: 'Project not found' }] };
      await assertMcpPermission('add_comment', orgId);
      const issue = await prisma.issue.findUnique({
        where: { projectId_number: { projectId, number: issueNumber } },
      });
      if (!issue) return { content: [{ type: 'text' as const, text: 'Issue not found' }] };
      const comment = await prisma.comment.create({
        data: { issueId: issue.id, authorId: userId, body },
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(comment, null, 2) }] };
    },
  );

  // ─── Wiki Tools ─────────────────────────────────────────────

  server.tool(
    'list_wiki_spaces',
    'List wiki spaces for a team',
    {
      teamId: z.string(),
      cursor: z.string().optional().describe('Cursor for pagination (space ID to start after)'),
      limit: z.number().optional().default(20).describe('Max results to return'),
    },
    async ({ teamId, cursor, limit }) => {
      const team = await prisma.team.findUnique({ where: { id: teamId } });
      if (!team) return { content: [{ type: 'text' as const, text: 'Team not found' }] };
      await assertMcpPermission('list_wiki_spaces', team.orgId);
      const take = Math.min(limit, 100);
      const spaces = await prisma.wikiSpace.findMany({
        where: { teamId },
        include: { _count: { select: { pages: true } } },
        orderBy: { id: 'asc' },
        take: take + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      const hasMore = spaces.length > take;
      const page = hasMore ? spaces.slice(0, take) : spaces;
      const result: Record<string, unknown> = { data: page };
      if (hasMore) result.next_cursor = page[page.length - 1].id;
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    'get_wiki_page',
    'Get a wiki page by space ID and page slug',
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
    },
  );

  server.tool(
    'create_wiki_page',
    'Create a new wiki page',
    {
      spaceId: z.string(),
      title: z.string(),
      slug: z.string(),
      body: z.string().default(''),
      parentId: z.string().optional(),
    },
    async ({ spaceId, title, slug, body, parentId }) => {
      const space = await prisma.wikiSpace.findUnique({ where: { id: spaceId } });
      if (!space) return { content: [{ type: 'text' as const, text: 'Space not found' }] };
      const team = await prisma.team.findUnique({ where: { id: space.teamId } });
      if (team) await assertMcpPermission('create_wiki_page', team.orgId);
      const existing = await prisma.page.findUnique({ where: { spaceId_slug: { spaceId, slug } } });
      if (existing)
        return { content: [{ type: 'text' as const, text: 'Page slug already exists' }] };
      const page = await prisma.page.create({
        data: {
          spaceId,
          title,
          slug,
          body,
          parentId,
          versions: { create: { version: 1, title, body, authorId: userId } },
        },
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(page, null, 2) }] };
    },
  );

  server.tool(
    'get_page_tree',
    'Get the full page tree structure of a wiki space',
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
        return (map.get(parentId) ?? []).map((p) => ({ ...p, children: buildTree(p.id) }));
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(buildTree(null), null, 2) }],
      };
    },
  );

  // ─── Git / Repos Tools ─────────────────────────────────────

  server.tool(
    'list_repos',
    'List repositories in a team',
    {
      teamId: z.string(),
      cursor: z.string().optional().describe('Cursor for pagination (repo ID to start after)'),
      limit: z.number().optional().default(20).describe('Max results to return'),
    },
    async ({ teamId, cursor, limit }) => {
      const team = await prisma.team.findUnique({ where: { id: teamId } });
      if (!team) return { content: [{ type: 'text' as const, text: 'Team not found' }] };
      await assertMcpPermission('list_repos', team.orgId);
      const take = Math.min(limit, 100);
      const repos = await prisma.repository.findMany({
        where: { teamId },
        select: {
          id: true,
          name: true,
          slug: true,
          description: true,
          visibility: true,
          defaultBranch: true,
        },
        orderBy: { id: 'asc' },
        take: take + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      const hasMore = repos.length > take;
      const page = hasMore ? repos.slice(0, take) : repos;
      const result: Record<string, unknown> = { data: page };
      if (hasMore) result.next_cursor = page[page.length - 1].id;
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    'browse_files',
    'List files and directories in a repository at a given path and ref',
    { repoId: z.string(), ref: z.string().default('HEAD'), path: z.string().default('') },
    async ({ repoId, ref, path }) => {
      const repo = await prisma.repository.findUnique({
        where: { id: repoId },
        include: { team: true },
      });
      if (!repo?.diskPath || !(await repoExists(repo.diskPath)))
        return { content: [{ type: 'text' as const, text: 'Repository not found' }] };
      await assertMcpPermission('browse_files', repo.team.orgId);
      const entries = await gitCmd.lsTree(repo.diskPath, ref, path);
      return { content: [{ type: 'text' as const, text: JSON.stringify(entries, null, 2) }] };
    },
  );

  server.tool(
    'read_file',
    'Read the content of a file in a repository at a given ref',
    { repoId: z.string(), ref: z.string().default('HEAD'), filePath: z.string() },
    async ({ repoId, ref, filePath }) => {
      const repo = await prisma.repository.findUnique({
        where: { id: repoId },
        include: { team: true },
      });
      if (!repo?.diskPath || !(await repoExists(repo.diskPath)))
        return { content: [{ type: 'text' as const, text: 'Repository not found' }] };
      await assertMcpPermission('read_file', repo.team.orgId);
      try {
        const content = await gitCmd.showBlob(repo.diskPath, ref, filePath);
        return { content: [{ type: 'text' as const, text: content }] };
      } catch {
        return { content: [{ type: 'text' as const, text: `File not found: ${filePath}` }] };
      }
    },
  );

  server.tool(
    'get_commits',
    'Get recent commits on a branch or ref in a repository',
    { repoId: z.string(), ref: z.string().default('HEAD'), limit: z.number().default(10) },
    async ({ repoId, ref, limit }) => {
      const repo = await prisma.repository.findUnique({
        where: { id: repoId },
        include: { team: true },
      });
      if (!repo?.diskPath || !(await repoExists(repo.diskPath)))
        return { content: [{ type: 'text' as const, text: 'Repository not found' }] };
      await assertMcpPermission('get_commits', repo.team.orgId);
      const commits = await gitCmd.log(repo.diskPath, ref, limit);
      return { content: [{ type: 'text' as const, text: JSON.stringify(commits, null, 2) }] };
    },
  );

  server.tool(
    'get_branches',
    'List all branches in a repository',
    { repoId: z.string() },
    async ({ repoId }) => {
      const repo = await prisma.repository.findUnique({
        where: { id: repoId },
        include: { team: true },
      });
      if (!repo?.diskPath || !(await repoExists(repo.diskPath)))
        return { content: [{ type: 'text' as const, text: 'Repository not found' }] };
      await assertMcpPermission('get_branches', repo.team.orgId);
      const branches = await gitCmd.listBranches(repo.diskPath, repo.defaultBranch);
      return { content: [{ type: 'text' as const, text: JSON.stringify(branches, null, 2) }] };
    },
  );

  server.tool(
    'get_diff',
    'Get the diff between two refs in a repository',
    { repoId: z.string(), base: z.string(), head: z.string() },
    async ({ repoId, base, head }) => {
      const repo = await prisma.repository.findUnique({
        where: { id: repoId },
        include: { team: true },
      });
      if (!repo?.diskPath || !(await repoExists(repo.diskPath)))
        return { content: [{ type: 'text' as const, text: 'Repository not found' }] };
      await assertMcpPermission('get_diff', repo.team.orgId);
      const diffOutput = await gitCmd.diff(repo.diskPath, base, head);
      const stats = await gitCmd.diffStat(repo.diskPath, base, head);
      return {
        content: [
          { type: 'text' as const, text: JSON.stringify({ diff: diffOutput, stats }, null, 2) },
        ],
      };
    },
  );

  server.tool(
    'list_pull_requests',
    'List pull requests in a repository, optionally filtered by status',
    {
      repoId: z.string(),
      status: z.enum(['OPEN', 'MERGED', 'CLOSED']).optional(),
      cursor: z.string().optional().describe('Cursor for pagination (PR ID to start after)'),
      limit: z.number().optional().default(20).describe('Max results to return'),
    },
    async ({ repoId, status, cursor, limit }) => {
      const repo = await prisma.repository.findUnique({
        where: { id: repoId },
        include: { team: true },
      });
      if (!repo) return { content: [{ type: 'text' as const, text: 'Repository not found' }] };
      await assertMcpPermission('list_pull_requests', repo.team.orgId);
      const where: Record<string, unknown> = { repoId };
      if (status) where.status = status;
      const take = Math.min(limit, 100);
      const prs = await prisma.pullRequest.findMany({
        where,
        take: take + 1,
        orderBy: { updatedAt: 'desc' },
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true,
          number: true,
          title: true,
          status: true,
          sourceBranch: true,
          targetBranch: true,
          authorId: true,
          createdAt: true,
          updatedAt: true,
          _count: { select: { reviews: true, comments: true } },
        },
      });
      const hasMore = prs.length > take;
      const page = hasMore ? prs.slice(0, take) : prs;
      const result: Record<string, unknown> = { data: page };
      if (hasMore) result.next_cursor = page[page.length - 1].id;
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  // ─── Update Issue Tool ──────────────────────────────────────

  server.tool(
    'update_issue',
    'Update an existing issue: change status (columnId), priority, assignee, labels, story points, or sprint',
    {
      projectId: z.string().describe('Project ID'),
      issueNumber: z.number().describe('Issue number within the project'),
      columnId: z
        .string()
        .optional()
        .describe('Board column ID to move the issue to (changes status)'),
      priority: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']).optional(),
      assigneeId: z.string().optional().describe('User ID to assign, or empty string to unassign'),
      labels: z.array(z.string()).optional().describe('Label names to set on the issue'),
      storyPoints: z.number().optional().describe('Story point estimate'),
      sprintId: z
        .string()
        .optional()
        .describe('Sprint ID to move issue to, or empty string to remove from sprint'),
    },
    async ({
      projectId,
      issueNumber,
      columnId,
      priority,
      assigneeId,
      labels,
      storyPoints,
      sprintId,
    }) => {
      const orgId = await getOrgIdFromProject(projectId);
      if (!orgId) return { content: [{ type: 'text' as const, text: 'Project not found' }] };
      await assertMcpPermission('update_issue', orgId);
      const issue = await prisma.issue.findUnique({
        where: { projectId_number: { projectId, number: issueNumber } },
      });
      if (!issue) return { content: [{ type: 'text' as const, text: 'Issue not found' }] };

      const updateData: Record<string, unknown> = {};
      if (columnId !== undefined) updateData.column = { connect: { id: columnId } };
      if (priority !== undefined) updateData.priority = priority;
      if (assigneeId !== undefined) {
        updateData.assignee = assigneeId ? { connect: { id: assigneeId } } : { disconnect: true };
      }
      if (storyPoints !== undefined) updateData.storyPoints = storyPoints;
      if (sprintId !== undefined) {
        updateData.sprint = sprintId ? { connect: { id: sprintId } } : { disconnect: true };
      }
      if (labels !== undefined) {
        updateData.labels = {
          set: [],
          connectOrCreate: labels.map((name) => ({
            where: { projectId_name: { projectId, name } },
            create: { projectId, name },
          })),
        };
      }

      const updated = await prisma.issue.update({
        where: { id: issue.id },
        data: updateData,
        include: {
          project: { select: { prefix: true } },
          assignee: { select: USER_BASIC_SELECT },
          labels: true,
          column: { select: { name: true } },
          sprint: { select: { id: true, name: true } },
        },
      });
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              { ...updated, key: `${updated.project.prefix}-${updated.number}` },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // ─── Create Pull Request Tool ─────────────────────────────

  server.tool(
    'create_pull_request',
    'Open a new pull request from a source branch to a target branch in a repository',
    {
      repoId: z.string().describe('Repository ID'),
      title: z.string().describe('PR title'),
      body: z.string().default('').describe('PR description'),
      sourceBranch: z.string().describe('Branch with changes'),
      targetBranch: z
        .string()
        .optional()
        .describe('Branch to merge into (defaults to repo default branch)'),
    },
    async ({ repoId, title, body, sourceBranch, targetBranch }) => {
      const repo = await prisma.repository.findUnique({
        where: { id: repoId },
        include: { team: true },
      });
      if (!repo) return { content: [{ type: 'text' as const, text: 'Repository not found' }] };
      await assertMcpPermission('create_pull_request', repo.team.orgId);

      const target = targetBranch || repo.defaultBranch;

      // Validate branches exist
      if (!repo.diskPath || !(await repoExists(repo.diskPath))) {
        return { content: [{ type: 'text' as const, text: 'Repository not found on disk' }] };
      }
      const sourceExists = await gitCmd.branchExists(repo.diskPath, sourceBranch);
      if (!sourceExists)
        return {
          content: [{ type: 'text' as const, text: `Source branch '${sourceBranch}' not found` }],
        };
      const targetExists = await gitCmd.branchExists(repo.diskPath, target);
      if (!targetExists)
        return {
          content: [{ type: 'text' as const, text: `Target branch '${target}' not found` }],
        };
      if (sourceBranch === target)
        return {
          content: [
            { type: 'text' as const, text: 'Source and target branches must be different' },
          ],
        };

      const lastPR = await prisma.pullRequest.findFirst({
        where: { repoId },
        orderBy: { number: 'desc' },
        select: { number: true },
      });
      const number = (lastPR?.number ?? 0) + 1;

      const pr = await prisma.pullRequest.create({
        data: {
          repoId,
          number,
          title,
          body,
          authorId: userId,
          sourceBranch,
          targetBranch: target,
          status: 'OPEN',
        },
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(pr, null, 2) }] };
    },
  );

  // ─── Get Pull Request Tool ────────────────────────────────

  server.tool(
    'get_pull_request',
    'Get details of a specific pull request including diff stats',
    {
      repoId: z.string().describe('Repository ID'),
      prNumber: z.number().describe('Pull request number'),
    },
    async ({ repoId, prNumber }) => {
      const repo = await prisma.repository.findUnique({
        where: { id: repoId },
        include: { team: true },
      });
      if (!repo) return { content: [{ type: 'text' as const, text: 'Repository not found' }] };
      await assertMcpPermission('get_pull_request', repo.team.orgId);

      const pr = await prisma.pullRequest.findUnique({
        where: { repoId_number: { repoId, number: prNumber } },
        include: {
          reviews: { orderBy: { createdAt: 'desc' } },
          comments: { orderBy: { createdAt: 'asc' } },
        },
      });
      if (!pr) return { content: [{ type: 'text' as const, text: 'Pull request not found' }] };

      let stats: unknown[] = [];
      if (repo.diskPath && (await repoExists(repo.diskPath))) {
        try {
          stats = await gitCmd.diffStat(repo.diskPath, pr.targetBranch, pr.sourceBranch);
        } catch {
          /* branch may have been deleted */
        }
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ ...pr, stats }, null, 2) }],
      };
    },
  );

  // ─── Search Tool ────────────────────────────────────────────

  server.tool(
    'search',
    'Global search across issues, repos, and wiki pages with a query string',
    {
      query: z
        .string()
        .describe(
          'Search query string. Supports structured filters like type:bug, priority:high, assignee:username',
        ),
      type: z
        .enum(['issues', 'wiki', 'repos', 'all'])
        .default('all')
        .describe('Type of resources to search'),
      limit: z.number().default(10),
    },
    async ({ query, type, limit }) => {
      const results: unknown[] = [];
      if (type === 'issues' || type === 'all') {
        const orgIds = await getUserOrgIds();
        const issues = await prisma.issue.findMany({
          where: {
            OR: [
              { title: { contains: query, mode: 'insensitive' } },
              { body: { contains: query, mode: 'insensitive' } },
            ],
            project: { team: { orgId: { in: orgIds } } },
          },
          include: { project: { select: { prefix: true } } },
          take: limit,
          orderBy: { updatedAt: 'desc' },
        });
        results.push(
          ...issues.map((i) => ({
            type: 'issue',
            key: `${i.project.prefix}-${i.number}`,
            title: i.title,
            priority: i.priority,
            issueType: i.type,
          })),
        );
      }
      if (type === 'repos' || type === 'all') {
        const orgIds = await getUserOrgIds();
        const repos = await prisma.repository.findMany({
          where: {
            OR: [
              { name: { contains: query, mode: 'insensitive' } },
              { description: { contains: query, mode: 'insensitive' } },
            ],
            team: { orgId: { in: orgIds } },
          },
          select: { id: true, name: true, slug: true, description: true, visibility: true },
          take: limit,
          orderBy: { updatedAt: 'desc' },
        });
        results.push(
          ...repos.map((r) => ({
            type: 'repo',
            id: r.id,
            name: r.name,
            slug: r.slug,
            description: r.description,
            visibility: r.visibility,
          })),
        );
      }
      if (type === 'wiki' || type === 'all') {
        const orgIds = await getUserOrgIds();
        const pages = await prisma.page.findMany({
          where: {
            OR: [
              { title: { contains: query, mode: 'insensitive' } },
              { body: { contains: query, mode: 'insensitive' } },
            ],
            space: { team: { orgId: { in: orgIds } } },
          },
          include: { space: { select: { name: true, slug: true } } },
          take: limit,
          orderBy: { updatedAt: 'desc' },
        });
        results.push(
          ...pages.map((p) => ({
            type: 'wiki',
            space: p.space.name,
            title: p.title,
            slug: p.slug,
          })),
        );
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] };
    },
  );

  // ─── Sprints Tools ────────────────────────────────────────

  server.tool(
    'list_sprints',
    'List sprints for a project, optionally filtered by status (PLANNING, ACTIVE, COMPLETED)',
    {
      projectId: z.string().describe('Project ID'),
      status: z
        .enum(['PLANNING', 'ACTIVE', 'COMPLETED'])
        .optional()
        .describe('Filter by sprint status'),
      cursor: z.string().optional().describe('Cursor for pagination (sprint ID to start after)'),
      limit: z.number().optional().default(20).describe('Max results to return'),
    },
    async ({ projectId, status, cursor, limit }) => {
      const orgId = await getOrgIdFromProject(projectId);
      if (!orgId) return { content: [{ type: 'text' as const, text: 'Project not found' }] };
      await assertMcpPermission('list_sprints', orgId);

      const where: Record<string, unknown> = { projectId };
      if (status) where.status = status;

      const take = Math.min(limit, 100);
      const sprints = await prisma.sprint.findMany({
        where,
        take: take + 1,
        include: { _count: { select: { issues: true } } },
        orderBy: { startDate: 'desc' },
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      const hasMore = sprints.length > take;
      const page = hasMore ? sprints.slice(0, take) : sprints;
      const result: Record<string, unknown> = { data: page };
      if (hasMore) result.next_cursor = page[page.length - 1].id;
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    'get_sprint',
    'Get a sprint with all its issues',
    {
      sprintId: z.string().describe('Sprint ID'),
    },
    async ({ sprintId }) => {
      const sprint = await prisma.sprint.findUnique({
        where: { id: sprintId },
        include: {
          project: { select: { prefix: true, team: { select: { orgId: true } } } },
          issues: {
            include: {
              assignee: { select: USER_BASIC_SELECT },
              labels: true,
              column: { select: { id: true, name: true } },
            },
          },
        },
      });
      if (!sprint) return { content: [{ type: 'text' as const, text: 'Sprint not found' }] };
      await assertMcpPermission('get_sprint', sprint.project.team.orgId);

      const result = {
        ...sprint,
        _storyPoints: sprint.issues.reduce((sum, i) => sum + (i.storyPoints ?? 0), 0),
        issues: sprint.issues.map((i) => ({
          ...i,
          key: `${sprint.project.prefix}-${i.number}`,
        })),
      };
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  // ─── List Branches Tool ───────────────────────────────────

  server.tool(
    'list_branches',
    'List all branches in a repository with their latest commit info',
    { repoId: z.string().describe('Repository ID') },
    async ({ repoId }) => {
      const repo = await prisma.repository.findUnique({
        where: { id: repoId },
        include: { team: true },
      });
      if (!repo?.diskPath || !(await repoExists(repo.diskPath)))
        return { content: [{ type: 'text' as const, text: 'Repository not found' }] };
      await assertMcpPermission('list_branches', repo.team.orgId);
      const branches = await gitCmd.listBranches(repo.diskPath, repo.defaultBranch);
      return { content: [{ type: 'text' as const, text: JSON.stringify(branches, null, 2) }] };
    },
  );

  // ─── Update Wiki Page Tool ────────────────────────────────

  server.tool(
    'update_wiki_page',
    'Update an existing wiki page title and/or body',
    {
      spaceId: z.string().describe('Wiki space ID'),
      pageSlug: z.string().describe('Current page slug'),
      title: z.string().optional().describe('New page title'),
      body: z.string().optional().describe('New page body content (markdown)'),
    },
    async ({ spaceId, pageSlug, title, body }) => {
      const space = await prisma.wikiSpace.findUnique({ where: { id: spaceId } });
      if (!space) return { content: [{ type: 'text' as const, text: 'Space not found' }] };
      const team = await prisma.team.findUnique({ where: { id: space.teamId } });
      if (team) await assertMcpPermission('update_wiki_page', team.orgId);

      const page = await prisma.page.findUnique({
        where: { spaceId_slug: { spaceId, slug: pageSlug } },
      });
      if (!page) return { content: [{ type: 'text' as const, text: 'Page not found' }] };

      const updateData: Record<string, unknown> = {};
      if (title !== undefined) updateData.title = title;
      if (body !== undefined) updateData.body = body;

      // Create a new version
      const lastVersion = await prisma.pageVersion.findFirst({
        where: { pageId: page.id },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      const nextVersion = (lastVersion?.version ?? 0) + 1;

      const updated = await prisma.page.update({
        where: { id: page.id },
        data: {
          ...updateData,
          versions: {
            create: {
              version: nextVersion,
              title: title ?? page.title,
              body: body ?? page.body,
              authorId: userId,
            },
          },
        },
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(updated, null, 2) }] };
    },
  );

  // ─── Merge Pull Request Tool ──────────────────────────────

  server.tool(
    'merge_pull_request',
    'Merge an open pull request. Supports merge, squash, or rebase strategies.',
    {
      repoId: z.string().describe('Repository ID'),
      prNumber: z.number().describe('Pull request number'),
      strategy: z
        .enum(['merge', 'squash', 'rebase'])
        .optional()
        .describe('Merge strategy (defaults to repo setting or merge)'),
    },
    async ({ repoId, prNumber, strategy }) => {
      const orgId = await getOrgIdFromRepo(repoId);
      if (!orgId) return { content: [{ type: 'text' as const, text: 'Repository not found' }] };
      await assertMcpPermission('merge_pull_request', orgId);
      try {
        const merged = await pullsService.mergePR(repoId, prNumber, strategy);
        return { content: [{ type: 'text' as const, text: JSON.stringify(merged, null, 2) }] };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Merge failed';
        return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true };
      }
    },
  );

  // ─── Delete Issue Tool ───────────────────────────────────

  server.tool(
    'delete_issue',
    'Permanently delete an issue from a project',
    {
      projectId: z.string().describe('Project ID'),
      issueNumber: z.number().describe('Issue number within the project'),
    },
    async ({ projectId, issueNumber }) => {
      const orgId = await getOrgIdFromProject(projectId);
      if (!orgId) return { content: [{ type: 'text' as const, text: 'Project not found' }] };
      await assertMcpPermission('delete_issue', orgId);
      try {
        await issuesService.deleteIssue(projectId, issueNumber, userId);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ deleted: true, issueNumber }, null, 2),
            },
          ],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Delete failed';
        return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true };
      }
    },
  );

  // ─── Sprint Write Tools ──────────────────────────────────

  server.tool(
    'create_sprint',
    'Create a new sprint in PLANNING status for a project',
    {
      projectId: z.string().describe('Project ID'),
      name: z.string().describe('Sprint name'),
      goal: z.string().optional().describe('Sprint goal'),
      startDate: z.string().describe('Start date (ISO 8601)'),
      endDate: z.string().describe('End date (ISO 8601)'),
    },
    async ({ projectId, name, goal, startDate, endDate }) => {
      const orgId = await getOrgIdFromProject(projectId);
      if (!orgId) return { content: [{ type: 'text' as const, text: 'Project not found' }] };
      await assertMcpPermission('create_sprint', orgId);
      try {
        const sprint = await sprintsService.createSprint(projectId, {
          name,
          goal,
          startDate,
          endDate,
        });
        return { content: [{ type: 'text' as const, text: JSON.stringify(sprint, null, 2) }] };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Create sprint failed';
        return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true };
      }
    },
  );

  server.tool(
    'start_sprint',
    'Start a sprint (move from PLANNING to ACTIVE). Only one active sprint per project is allowed.',
    {
      sprintId: z.string().describe('Sprint ID'),
    },
    async ({ sprintId }) => {
      const orgId = await getOrgIdFromSprint(sprintId);
      if (!orgId) return { content: [{ type: 'text' as const, text: 'Sprint not found' }] };
      await assertMcpPermission('start_sprint', orgId);
      try {
        const sprint = await sprintsService.startSprint(sprintId);
        return { content: [{ type: 'text' as const, text: JSON.stringify(sprint, null, 2) }] };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Start sprint failed';
        return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true };
      }
    },
  );

  server.tool(
    'complete_sprint',
    'Complete an active sprint. Incomplete issues can be moved to another sprint or backlog.',
    {
      sprintId: z.string().describe('Sprint ID'),
      moveToSprintId: z
        .string()
        .optional()
        .describe('Sprint ID to move incomplete issues to. Omit to move to backlog.'),
    },
    async ({ sprintId, moveToSprintId }) => {
      const orgId = await getOrgIdFromSprint(sprintId);
      if (!orgId) return { content: [{ type: 'text' as const, text: 'Sprint not found' }] };
      await assertMcpPermission('complete_sprint', orgId);
      try {
        const sprint = await sprintsService.completeSprint(sprintId, moveToSprintId);
        return { content: [{ type: 'text' as const, text: JSON.stringify(sprint, null, 2) }] };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Complete sprint failed';
        return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true };
      }
    },
  );

  server.tool(
    'add_issues_to_sprint',
    'Add one or more issues to a sprint by their issue IDs',
    {
      sprintId: z.string().describe('Sprint ID'),
      issueIds: z.array(z.string()).describe('Array of issue IDs to add to the sprint'),
    },
    async ({ sprintId, issueIds }) => {
      const orgId = await getOrgIdFromSprint(sprintId);
      if (!orgId) return { content: [{ type: 'text' as const, text: 'Sprint not found' }] };
      await assertMcpPermission('add_issues_to_sprint', orgId);
      try {
        const sprint = await sprintsService.addIssuesToSprint(sprintId, issueIds);
        return { content: [{ type: 'text' as const, text: JSON.stringify(sprint, null, 2) }] };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Add issues to sprint failed';
        return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true };
      }
    },
  );

  // ─── Delete Wiki Page Tool ───────────────────────────────

  server.tool(
    'delete_wiki_page',
    'Permanently delete a wiki page from a space',
    {
      spaceId: z.string().describe('Wiki space ID'),
      pageSlug: z.string().describe('Page slug to delete'),
    },
    async ({ spaceId, pageSlug }) => {
      const space = await prisma.wikiSpace.findUnique({ where: { id: spaceId } });
      if (!space) return { content: [{ type: 'text' as const, text: 'Space not found' }] };
      const team = await prisma.team.findUnique({ where: { id: space.teamId } });
      if (team) await assertMcpPermission('delete_wiki_page', team.orgId);
      try {
        await wikiService.deletePage(spaceId, pageSlug, userId);
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify({ deleted: true, pageSlug }, null, 2) },
          ],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Delete failed';
        return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true };
      }
    },
  );

  // ─── Pipeline Tools ──────────────────────────────────────

  server.tool(
    'list_pipelines',
    'List CI/CD pipelines for a repository',
    {
      repoId: z.string().describe('Repository ID'),
      cursor: z.string().optional().describe('Cursor for pagination (pipeline ID to start after)'),
      limit: z.number().optional().default(20).describe('Max results to return'),
    },
    async ({ repoId, cursor, limit }) => {
      const orgId = await getOrgIdFromRepo(repoId);
      if (!orgId) return { content: [{ type: 'text' as const, text: 'Repository not found' }] };
      await assertMcpPermission('list_pipelines', orgId);
      try {
        const allPipelines = await pipelinesService.listPipelines(repoId);
        // Apply cursor-based pagination over the result
        const take = Math.min(limit, 100);
        let startIdx = 0;
        if (cursor) {
          const idx = allPipelines.findIndex((p) => p.id === cursor);
          if (idx >= 0) startIdx = idx + 1;
        }
        const page = allPipelines.slice(startIdx, startIdx + take);
        const hasMore = startIdx + take < allPipelines.length;
        const result: Record<string, unknown> = { data: page };
        if (hasMore) result.next_cursor = page[page.length - 1].id;
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'List pipelines failed';
        return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true };
      }
    },
  );

  server.tool(
    'trigger_pipeline',
    'Trigger a CI/CD pipeline run on a specific git ref (branch or tag)',
    {
      pipelineId: z.string().describe('Pipeline ID'),
      repoId: z.string().describe('Repository ID'),
      ref: z.string().describe('Git ref to run the pipeline on (branch name or tag)'),
    },
    async ({ pipelineId, repoId, ref }) => {
      const orgId = await getOrgIdFromRepo(repoId);
      if (!orgId) return { content: [{ type: 'text' as const, text: 'Repository not found' }] };
      await assertMcpPermission('trigger_pipeline', orgId);
      try {
        const run = await pipelinesService.triggerRun(pipelineId, repoId, userId, ref);
        return { content: [{ type: 'text' as const, text: JSON.stringify(run, null, 2) }] };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Trigger pipeline failed';
        return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true };
      }
    },
  );

  // ─── Release Tools ───────────────────────────────────────

  server.tool(
    'list_releases',
    'List releases for a repository, optionally filtered by draft or prerelease status',
    {
      repoId: z.string().describe('Repository ID'),
      draft: z.boolean().optional().describe('Filter by draft status'),
      prerelease: z.boolean().optional().describe('Filter by prerelease status'),
      cursor: z.string().optional().describe('Cursor for pagination (release ID to start after)'),
      limit: z.number().optional().default(20).describe('Max results to return'),
    },
    async ({ repoId, draft, prerelease, cursor, limit }) => {
      const orgId = await getOrgIdFromRepo(repoId);
      if (!orgId) return { content: [{ type: 'text' as const, text: 'Repository not found' }] };
      await assertMcpPermission('list_releases', orgId);
      try {
        const allReleases = await releasesService.listReleases(repoId, { draft, prerelease });
        const take = Math.min(limit, 100);
        let startIdx = 0;
        if (cursor) {
          const idx = allReleases.findIndex((r) => r.id === cursor);
          if (idx >= 0) startIdx = idx + 1;
        }
        const page = allReleases.slice(startIdx, startIdx + take);
        const hasMore = startIdx + take < allReleases.length;
        const result: Record<string, unknown> = { data: page };
        if (hasMore) result.next_cursor = page[page.length - 1].id;
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'List releases failed';
        return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true };
      }
    },
  );

  server.tool(
    'create_release',
    'Create a new release for a repository with a tag name and target branch',
    {
      repoId: z.string().describe('Repository ID'),
      tagName: z.string().describe('Tag name for the release (e.g. v1.0.0)'),
      title: z.string().describe('Release title'),
      body: z.string().optional().default('').describe('Release description (markdown)'),
      targetBranch: z.string().describe('Branch to create the release from'),
      isDraft: z.boolean().optional().default(false).describe('Create as draft release'),
      isPrerelease: z.boolean().optional().default(false).describe('Mark as prerelease'),
      commitSha: z
        .string()
        .optional()
        .describe('Specific commit SHA to tag (defaults to branch HEAD)'),
    },
    async ({ repoId, tagName, title, body, targetBranch, isDraft, isPrerelease, commitSha }) => {
      const orgId = await getOrgIdFromRepo(repoId);
      if (!orgId) return { content: [{ type: 'text' as const, text: 'Repository not found' }] };
      await assertMcpPermission('create_release', orgId);
      try {
        const release = await releasesService.createRelease(repoId, userId, {
          tagName,
          title,
          body,
          targetBranch,
          isDraft,
          isPrerelease,
          commitSha,
        });
        return { content: [{ type: 'text' as const, text: JSON.stringify(release, null, 2) }] };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Create release failed';
        return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true };
      }
    },
  );

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
