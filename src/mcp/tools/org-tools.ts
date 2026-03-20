import { z } from 'zod';

import { prisma } from '../../config/database';
import { assertMcpPermission } from '../mcp-permissions';

import type { McpToolContext } from './types';

/**
 *
 * @param ctx
 */
export function registerOrgTools(ctx: McpToolContext) {
  const { server, userId } = ctx;

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
}
