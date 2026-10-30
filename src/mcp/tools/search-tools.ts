import { z } from 'zod';

import { prisma } from '../../config/database';
import { scopesCover } from '../../middleware/token-scopes';
import { viewableIssuesWhere, viewablePagesWhere } from '../../modules/search/search-access';
import { mcpContext } from '../context';
import { assertMcpToolAllowed } from '../mcp-permissions';

import type { McpToolContext } from './types';

/**
 *
 * @param ctx
 */
export function registerSearchTools(ctx: McpToolContext) {
  const { server, userId } = ctx;

  server.tool(
    'search',
    'Global search across issues and wiki pages with a query string',
    {
      query: z
        .string()
        .describe(
          'Search query string. Supports structured filters like type:bug, priority:high, assignee:username',
        ),
      type: z
        .enum(['issues', 'wiki', 'all'])
        .default('all')
        .describe('Type of resources to search'),
      limit: z.number().default(10),
    },
    async ({ query, type, limit }) => {
      assertMcpToolAllowed('search');
      const results: unknown[] = [];
      // A call made with an API token only searches the areas its scopes cover
      const scopes = mcpContext.getStore()?.scopes;
      const issuesAllowed = !scopes || scopesCover(scopes, 'issues', false);
      const wikiAllowed = !scopes || scopesCover(scopes, 'wiki', false);
      if (issuesAllowed && (type === 'issues' || type === 'all')) {
        const issues = await prisma.issue.findMany({
          where: {
            OR: [
              { title: { contains: query, mode: 'insensitive' } },
              { body: { contains: query, mode: 'insensitive' } },
            ],
            // Only issues the user could open, as REST search
            AND: [await viewableIssuesWhere(userId)],
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
      if (wikiAllowed && (type === 'wiki' || type === 'all')) {
        const pages = await prisma.page.findMany({
          where: {
            OR: [
              { title: { contains: query, mode: 'insensitive' } },
              { body: { contains: query, mode: 'insensitive' } },
            ],
            // Only pages the user could open: space access and page restrictions, as REST
            AND: [await viewablePagesWhere(userId)],
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
