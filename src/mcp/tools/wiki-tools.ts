import { z } from 'zod';

import { prisma } from '../../config/database';
import { resolveWikiTemplate } from '../../modules/wiki/wiki-template-resolver.service';
import * as wikiService from '../../modules/wiki/wiki.service';
import { ERR } from '../../utils/error-messages';
import { assertMcpPermission } from '../mcp-permissions';

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
      if (!space) return { content: [{ type: 'text' as const, text: ERR.SPACE_NOT_FOUND }] };
      const team = await prisma.team.findUnique({ where: { id: space.teamId } });
      if (team) await assertMcpPermission('get_wiki_page', team.orgId);
      const page = await prisma.page.findUnique({
        where: { spaceId_slug: { spaceId, slug: pageSlug } },
        include: { children: { select: { title: true, slug: true } } },
      });
      if (!page) return { content: [{ type: 'text' as const, text: ERR.PAGE_NOT_FOUND }] };
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
      const team = await prisma.team.findUnique({ where: { id: space.teamId } });
      if (team) await assertMcpPermission('create_wiki_page', team.orgId);
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

      const page = await prisma.page.create({
        data: {
          spaceId,
          title,
          slug,
          body: pageBody,
          parentId,
          versions: { create: { version: 1, title, body: pageBody, authorId: userId } },
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
      if (!space) return { content: [{ type: 'text' as const, text: ERR.SPACE_NOT_FOUND }] };
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
      const team = await prisma.team.findUnique({ where: { id: space.teamId } });
      if (team) await assertMcpPermission('update_wiki_page', team.orgId);

      const page = await prisma.page.findUnique({
        where: { spaceId_slug: { spaceId, slug: pageSlug } },
      });
      if (!page) return { content: [{ type: 'text' as const, text: ERR.PAGE_NOT_FOUND }] };

      const updateData: Record<string, unknown> = {};
      if (title !== undefined) updateData.title = title;
      if (body !== undefined) updateData.body = body;

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
}
