import { z } from 'zod';

import { prisma } from '../../config/database';
import { canViewPage } from '../../modules/wiki/wiki-permissions.service';
import { resolveWikiTemplate } from '../../modules/wiki/wiki-template-resolver.service';
import * as wikiService from '../../modules/wiki/wiki.service';
import { ERR } from '../../utils/error-messages';
import {
  assertMcpPagePermission,
  assertMcpSpacePermission,
  assertMcpTeamPermission,
} from '../mcp-permissions';

import type { McpToolContext } from './types';

/**
 *
 * @param ctx
 */
export function registerWikiTools(ctx: McpToolContext) {
  const { server, userId } = ctx;

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
      if (!team) return { content: [{ type: 'text' as const, text: ERR.TEAM_NOT_FOUND }] };
      await assertMcpTeamPermission('list_wiki_spaces', teamId);
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
      if (!space) return { content: [{ type: 'text' as const, text: ERR.SPACE_NOT_FOUND }] };
      await assertMcpSpacePermission('get_wiki_page', spaceId, 'VIEW');
      const page = await prisma.page.findUnique({
        where: { spaceId_slug: { spaceId, slug: pageSlug } },
        include: { children: { select: { id: true, title: true, slug: true } } },
      });
      if (!page) return { content: [{ type: 'text' as const, text: ERR.PAGE_NOT_FOUND }] };
      await assertMcpPagePermission('get_wiki_page', page.id, 'view');
      // Child links follow the same rule: titles of pages the user can't view stay hidden
      const children = [];
      for (const child of page.children) {
        if (await canViewPage(userId, child.id)) {
          children.push({ title: child.title, slug: child.slug });
        }
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ ...page, children }, null, 2) }],
      };
    },
  );

  server.tool(
    'create_wiki_page',
    'Create a new wiki page',
    {
      spaceId: z.string(),
      title: z.string(),
      slug: z.string(),
      body: z.string().optional().default(''),
      parentId: z.string().optional(),
      templateId: z
        .string()
        .optional()
        .describe('Create page from template with auto-resolved variables'),
    },
    async ({ spaceId, title, slug, body, parentId, templateId }) => {
      const space = await prisma.wikiSpace.findUnique({ where: { id: spaceId } });
      if (!space) return { content: [{ type: 'text' as const, text: ERR.SPACE_NOT_FOUND }] };
      await assertMcpSpacePermission('create_wiki_page', spaceId, 'EDIT');
      const existing = await prisma.page.findUnique({ where: { spaceId_slug: { spaceId, slug } } });
      if (existing)
        return { content: [{ type: 'text' as const, text: 'Page slug already exists' }] };

      let pageBody = body ?? '';
      if (!body && templateId) {
        const template = await prisma.pageTemplate.findUnique({ where: { id: templateId } });
        if (template) {
          pageBody = await resolveWikiTemplate(template.body, {
            teamId: space.teamId,
            spaceId,
            userId,
          });
        }
      }

      const page = await wikiService.createPage(spaceId, userId, {
        title,
        slug,
        body: pageBody,
        parentId,
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
      if (!space) return { content: [{ type: 'text' as const, text: ERR.SPACE_NOT_FOUND }] };
      await assertMcpSpacePermission('get_page_tree', spaceId, 'VIEW');
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
      if (!space) return { content: [{ type: 'text' as const, text: ERR.SPACE_NOT_FOUND }] };
      await assertMcpSpacePermission('update_wiki_page', spaceId, 'EDIT');

      try {
        const updated = await wikiService.updatePage(
          spaceId,
          pageSlug,
          userId,
          { title, body },
          { source: 'mcp' },
        );
        const note = updated.pendingMerge
          ? 'Saved, and the page is open in a live editing session: Page.body holds this change, and the session will merge it with its own edits (externalVersionId).\n'
          : '';
        return {
          content: [{ type: 'text' as const, text: note + JSON.stringify(updated, null, 2) }],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Update failed';
        return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true };
      }
    },
  );

  server.tool(
    'delete_wiki_page',
    'Permanently delete a wiki page from a space',
    {
      spaceId: z.string().describe('Wiki space ID'),
      pageSlug: z.string().describe('Page slug to delete'),
    },
    async ({ spaceId, pageSlug }) => {
      const space = await prisma.wikiSpace.findUnique({ where: { id: spaceId } });
      if (!space) return { content: [{ type: 'text' as const, text: ERR.SPACE_NOT_FOUND }] };
      await assertMcpSpacePermission('delete_wiki_page', spaceId, 'EDIT');
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
}
