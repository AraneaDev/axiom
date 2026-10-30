import { z } from 'zod';

import { prisma } from '../../config/database';
import * as wikiIssueLinksService from '../../modules/wiki/wiki-issue-links.service';
import { ERR } from '../../utils/error-messages';
import { assertMcpPagePermission, assertMcpProjectPermission } from '../mcp-permissions';

import type { McpToolContext } from './types';

/**
 *
 * @param ctx
 */
export function registerIntegrationTools(ctx: McpToolContext) {
  const { server, userId } = ctx;

  server.tool(
    'list_wiki_issue_links',
    'List links between wiki pages and issues. Provide either pageId or issueId (at least one required)',
    {
      pageId: z.string().optional().describe('Wiki page ID to get links for'),
      issueId: z.string().optional().describe('Issue ID to get links for'),
    },
    async ({ pageId, issueId }) => {
      if (!pageId && !issueId) {
        return {
          content: [{ type: 'text' as const, text: 'Either pageId or issueId must be provided' }],
        };
      }

      if (pageId) {
        const orgId = await ctx.getOrgIdFromPage(pageId);
        if (!orgId) return { content: [{ type: 'text' as const, text: ERR.PAGE_NOT_FOUND }] };
        await assertMcpPagePermission('list_wiki_issue_links', pageId, 'view');
        const links = await wikiIssueLinksService.getLinksForPage(pageId);
        return { content: [{ type: 'text' as const, text: JSON.stringify(links, null, 2) }] };
      }

      // issueId path
      const issue = await prisma.issue.findUnique({
        where: { id: issueId! },
        include: { project: { include: { team: { select: { orgId: true } } } } },
      });
      if (!issue) return { content: [{ type: 'text' as const, text: ERR.ISSUE_NOT_FOUND }] };
      // Reading an issue's links needs what reading the issue needs
      await assertMcpProjectPermission('get_issue', issue.projectId);
      const links = await wikiIssueLinksService.getLinksForIssue(issueId!);
      return { content: [{ type: 'text' as const, text: JSON.stringify(links, null, 2) }] };
    },
  );

  server.tool(
    'link_wiki_to_issue',
    'Create a link between a wiki page and an issue',
    {
      pageId: z.string().describe('Wiki page ID'),
      issueId: z.string().describe('Issue ID'),
      linkType: z.enum(['EMBED', 'MENTION']).describe('Type of link'),
    },
    async ({ pageId, issueId, linkType }) => {
      const orgId = await ctx.getOrgIdFromPage(pageId);
      if (!orgId) return { content: [{ type: 'text' as const, text: ERR.PAGE_NOT_FOUND }] };
      await assertMcpPagePermission('link_wiki_to_issue', pageId, 'edit');
      // The issue must be one the user can see, as on the REST link routes
      const issue = await prisma.issue.findUnique({
        where: { id: issueId },
        select: { projectId: true },
      });
      if (!issue) return { content: [{ type: 'text' as const, text: ERR.ISSUE_NOT_FOUND }] };
      await assertMcpProjectPermission('get_issue', issue.projectId);
      const link = await wikiIssueLinksService.addLink(pageId, issueId, linkType, userId);
      return { content: [{ type: 'text' as const, text: JSON.stringify(link, null, 2) }] };
    },
  );
}
