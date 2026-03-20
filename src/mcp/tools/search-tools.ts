import { z } from 'zod';

import { prisma } from '../../config/database';

import type { McpToolContext } from './types';

/**
 *
 * @param ctx
 */
export function registerSearchTools(ctx: McpToolContext) {
  const { server, getUserOrgIds } = ctx;

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
}
