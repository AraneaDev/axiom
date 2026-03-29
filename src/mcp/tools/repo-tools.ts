import { z } from 'zod';

import { prisma } from '../../config/database';
import * as gitCmd from '../../git/git-commands';
import { grepFiles } from '../../git/git-search-commands';
import { repoExists } from '../../git/repo-manager';
import * as pipelinesService from '../../modules/pipelines/pipelines.service';
import * as pullsService from '../../modules/pulls/pulls.service';
import * as releasesService from '../../modules/releases/releases.service';
import { assertMcpPermission } from '../mcp-permissions';

import type { McpToolContext } from './types';

/**
 *
 * @param ctx
 */
export function registerRepoTools(ctx: McpToolContext) {
  const { server, userId, getOrgIdFromRepo } = ctx;

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

  // Pipeline tools

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

  // Release tools

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

  // Code search

  server.tool(
    'search_code',
    'Search file contents in a repository using git grep',
    {
      query: z.string().describe('Search pattern (fixed string)'),
      repoId: z.string().describe('Repository ID to search in'),
      filePattern: z.string().optional().describe('Glob pattern to filter files (e.g. "*.ts")'),
    },
    async ({ query, repoId, filePattern }) => {
      const repo = await prisma.repository.findUnique({
        where: { id: repoId },
        include: { team: true },
      });
      if (!repo?.diskPath || !(await repoExists(repo.diskPath)))
        return { content: [{ type: 'text' as const, text: 'Repository not found' }] };
      await assertMcpPermission('search_code', repo.team.orgId);
      const results = await grepFiles(repo.diskPath, query, { filePattern, maxResults: 100 });
      return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] };
    },
  );

  // PR diff

  server.tool(
    'get_pr_diff',
    'Get the full diff for a pull request',
    {
      repoId: z.string().describe('Repository ID'),
      pullNumber: z.number().describe('Pull request number'),
    },
    async ({ repoId, pullNumber }) => {
      const orgId = await getOrgIdFromRepo(repoId);
      if (!orgId) return { content: [{ type: 'text' as const, text: 'Repository not found' }] };
      await assertMcpPermission('get_pr_diff', orgId);

      const repo = await prisma.repository.findUnique({ where: { id: repoId } });
      if (!repo?.diskPath || !(await repoExists(repo.diskPath)))
        return { content: [{ type: 'text' as const, text: 'Repository not found on disk' }] };

      const pr = await prisma.pullRequest.findUnique({
        where: { repoId_number: { repoId, number: pullNumber } },
      });
      if (!pr) return { content: [{ type: 'text' as const, text: 'Pull request not found' }] };

      try {
        let diffOutput = await gitCmd.diff(repo.diskPath, pr.targetBranch, pr.sourceBranch);
        const MAX_SIZE = 100 * 1024; // 100KB
        let truncated = false;
        if (diffOutput.length > MAX_SIZE) {
          diffOutput = diffOutput.slice(0, MAX_SIZE);
          truncated = true;
        }
        const stats = await gitCmd.diffStat(repo.diskPath, pr.targetBranch, pr.sourceBranch);
        const result = truncated
          ? `${diffOutput}\n\n--- Output truncated at 100KB. Use get_diff with specific refs for targeted diffs. ---`
          : diffOutput;
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify({ diff: result, stats }, null, 2) },
          ],
        };
      } catch {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'Could not compute diff -- branches may have been deleted',
            },
          ],
        };
      }
    },
  );

  // PR comments

  server.tool(
    'get_pr_comments',
    'Get comments on a pull request, including inline file comments and threads',
    {
      repoId: z.string().describe('Repository ID'),
      pullNumber: z.number().describe('Pull request number'),
    },
    async ({ repoId, pullNumber }) => {
      const orgId = await getOrgIdFromRepo(repoId);
      if (!orgId) return { content: [{ type: 'text' as const, text: 'Repository not found' }] };
      await assertMcpPermission('get_pr_comments', orgId);

      const pr = await prisma.pullRequest.findUnique({
        where: { repoId_number: { repoId, number: pullNumber } },
      });
      if (!pr) return { content: [{ type: 'text' as const, text: 'Pull request not found' }] };

      const comments = await prisma.pRComment.findMany({
        where: { prId: pr.id },
        orderBy: { createdAt: 'asc' },
      });

      const authorIds = [...new Set(comments.map((c) => c.authorId))];
      const authors = await prisma.user.findMany({
        where: { id: { in: authorIds } },
        select: { id: true, username: true, displayName: true },
      });
      const authorMap = new Map(authors.map((a) => [a.id, a]));

      const result = comments.map((c) => ({
        id: c.id,
        body: c.body,
        filePath: c.filePath,
        line: c.line,
        parentId: c.parentId,
        author: authorMap.get(c.authorId) ?? { id: c.authorId, username: null, displayName: null },
        createdAt: c.createdAt,
      }));

      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  // Recent merges

  server.tool(
    'get_recent_merges',
    'Get recently merged pull requests for a repository, optionally filtered by date',
    {
      repoId: z.string().describe('Repository ID'),
      since: z
        .string()
        .optional()
        .describe('ISO date string to filter merges after (uses updatedAt)'),
      limit: z.number().optional().default(10).describe('Max results to return'),
    },
    async ({ repoId, since, limit }) => {
      const orgId = await getOrgIdFromRepo(repoId);
      if (!orgId) return { content: [{ type: 'text' as const, text: 'Repository not found' }] };
      await assertMcpPermission('get_recent_merges', orgId);

      const take = Math.min(limit, 100);
      const where: Record<string, unknown> = { repoId, status: 'MERGED' };
      if (since) {
        where.updatedAt = { gte: new Date(since) };
      }

      const prs = await prisma.pullRequest.findMany({
        where,
        take,
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true,
          number: true,
          title: true,
          sourceBranch: true,
          targetBranch: true,
          authorId: true,
          mergeStrategy: true,
          createdAt: true,
          updatedAt: true,
          linkedIssues: {
            include: {
              issue: {
                select: {
                  id: true,
                  number: true,
                  title: true,
                  status: true,
                },
              },
            },
          },
        },
      });

      return { content: [{ type: 'text' as const, text: JSON.stringify(prs, null, 2) }] };
    },
  );
}
