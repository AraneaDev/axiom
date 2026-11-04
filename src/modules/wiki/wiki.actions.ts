import { z } from 'zod';

import { pageAccess, pageBySlugAccess, spaceAccess, teamPermission } from '../../actions/authorize';
import { defineAction } from '../../actions/define';
import { registerActions } from '../../actions/registry';
import { AppError } from '../../middleware/errorHandler';
import {
  applyMergeSchema,
  copyPageSchema,
  createPageSchema,
  movePageSchema,
  reorderPageSchema,
  restoreVersionSchema,
  updatePageSchema,
} from '../../utils/validation';

import { assertPageDestinationWritable } from './page-destination';
import { hydrateWikiPage } from './wiki-hydrate.service';
import * as linkService from './wiki-issue-links.service';
import { hiddenPageIds, pruneHiddenPages } from './wiki-permissions.service';
import * as wikiService from './wiki.service';

// Responses keep the shape the REST routes always had (R3): the output schemas name the key
// fields and pass the rest through
const record = z.looseObject({ id: z.string() });
const loose = z.looseObject({});
const list = z.array(loose);
const nothing = z.void();

const WIKI = '/api/wiki';
const SPACE = `${WIKI}/spaces/:spaceId`;
const PAGE = `${SPACE}/pages/:pageSlug`;
const PAGE_BY_ID = `${WIKI}/pages/:pageId`;

// Authorization runs on the ids alone (R10), so a refused caller keeps today's 403/404 whatever
// the rest of the input holds. Every input extends its target (R11).
const teamTarget = z.object({ teamId: z.string() });
const spaceTarget = z.object({ spaceId: z.string() });
const slugTarget = spaceTarget.extend({ pageSlug: z.string() });
const pageTarget = z.object({ pageId: z.string() });

const inTeam = teamPermission<z.infer<typeof teamTarget>>('wiki:view', (i) => i.teamId);
const viewSpace = spaceAccess<z.infer<typeof spaceTarget>>('VIEW', (i) => i.spaceId);
const editSpace = spaceAccess<z.infer<typeof spaceTarget>>('EDIT', (i) => i.spaceId);
type SlugInput = z.infer<typeof slugTarget>;
const viewBySlug = pageBySlugAccess<SlugInput>(
  'VIEW',
  'view',
  (i) => i.spaceId,
  (i) => i.pageSlug,
);
const editBySlug = pageBySlugAccess<SlugInput>(
  'EDIT',
  'edit',
  (i) => i.spaceId,
  (i) => i.pageSlug,
);
type PageInput = z.infer<typeof pageTarget>;
const viewPage = pageAccess<PageInput>('view', (i) => i.pageId);
const editPage = pageAccess<PageInput>('edit', (i) => i.pageId);

/**
 * A version number from the query string, as the diff route always read it.
 * @param value - The query value
 */
function versionNumber(value: unknown): number {
  return parseInt(String(value), 10);
}

// A bad or missing value reads as '', which is NaN: the handler gives the one message the route
// always gave
const versionParam = z.union([z.string(), z.number()]).catch('');

const spaceActions = [
  defineAction({
    name: 'space.list',
    area: 'wiki',
    kind: 'read',
    summary: 'List the wiki spaces of a team',
    target: teamTarget,
    // Anything but true or the string 'true' reads as false, as it always did
    input: teamTarget.extend({ includeArchived: z.union([z.boolean(), z.string()]).optional() }),
    output: list,
    rest: { method: 'GET', path: `${WIKI}/team/:teamId/spaces` },
    authorize: inTeam,
    handler: async (ctx, { teamId, includeArchived }) =>
      wikiService.listSpaces(
        teamId,
        includeArchived === true || includeArchived === 'true',
        ctx.userId,
      ),
  }),
  defineAction({
    name: 'space.get',
    area: 'wiki',
    kind: 'read',
    summary: 'Get a wiki space with its top-level pages',
    input: spaceTarget,
    output: record,
    rest: { method: 'GET', path: SPACE },
    authorize: viewSpace,
    handler: async (ctx, { spaceId }) => wikiService.getSpace(spaceId, ctx.userId),
  }),
  defineAction({
    name: 'page.tree',
    area: 'wiki',
    kind: 'read',
    summary: 'The page tree of a space, without the pages the caller may not see',
    input: spaceTarget,
    output: list,
    rest: { method: 'GET', path: `${SPACE}/tree` },
    authorize: viewSpace,
    handler: async (ctx, { spaceId }) => {
      // The tree is cached per space: hide restricted pages per user after the cache
      return pruneHiddenPages(
        await wikiService.getPageTree(spaceId),
        await hiddenPageIds(ctx.userId, spaceId),
      );
    },
  }),
];

const pageActions = [
  defineAction({
    name: 'page.create',
    area: 'wiki',
    kind: 'write',
    summary: 'Create a page in a space',
    target: spaceTarget,
    input: spaceTarget.extend(createPageSchema.shape),
    output: record,
    rest: { method: 'POST', path: `${SPACE}/pages` },
    authorize: editSpace,
    handler: async (ctx, { spaceId, ...data }) => wikiService.createPage(spaceId, ctx.userId, data),
  }),
  defineAction({
    name: 'page.get',
    area: 'wiki',
    kind: 'read',
    summary: 'Get a page by its slug',
    input: slugTarget,
    output: record,
    rest: { method: 'GET', path: PAGE },
    authorize: viewBySlug,
    handler: async (ctx, { spaceId, pageSlug }) =>
      wikiService.getPage(spaceId, pageSlug, ctx.userId),
  }),
  defineAction({
    name: 'page.update',
    area: 'wiki',
    kind: 'write',
    summary: 'Update a page; fields left out keep their value',
    target: slugTarget,
    input: slugTarget.extend(updatePageSchema.shape),
    output: record,
    rest: { method: 'PATCH', path: PAGE },
    authorize: editBySlug,
    handler: async (ctx, { spaceId, pageSlug, ...data }) =>
      wikiService.updatePage(spaceId, pageSlug, ctx.userId, data),
  }),
  defineAction({
    name: 'page.delete',
    area: 'wiki',
    kind: 'write',
    summary: 'Delete a page',
    input: slugTarget,
    output: nothing,
    rest: { method: 'DELETE', path: PAGE },
    authorize: editBySlug,
    handler: async (ctx, { spaceId, pageSlug }) => {
      await wikiService.deletePage(spaceId, pageSlug, ctx.userId);
    },
  }),
  defineAction({
    name: 'page.hydrate',
    area: 'wiki',
    kind: 'read',
    summary: 'A page with its labels, attachments, history and children in one call',
    input: slugTarget,
    output: z.looseObject({ page: record }),
    rest: { method: 'GET', path: `${PAGE}/hydrate` },
    authorize: viewBySlug,
    handler: async (ctx, { spaceId, pageSlug }) => hydrateWikiPage(spaceId, pageSlug, ctx.userId),
  }),
  defineAction({
    name: 'page.history',
    area: 'wiki',
    kind: 'read',
    summary: 'The versions of a page, newest first',
    input: slugTarget,
    output: list,
    rest: { method: 'GET', path: `${PAGE}/history` },
    authorize: viewBySlug,
    handler: async (_ctx, { spaceId, pageSlug }) => wikiService.getPageHistory(spaceId, pageSlug),
  }),
  defineAction({
    name: 'page.diff',
    area: 'wiki',
    kind: 'read',
    summary: 'Compare two versions of a page',
    target: slugTarget,
    input: slugTarget.extend({ from: versionParam, to: versionParam }),
    output: loose,
    rest: { method: 'GET', path: `${PAGE}/diff` },
    authorize: viewBySlug,
    handler: async (_ctx, { spaceId, pageSlug, from, to }) => {
      const fromVersion = versionNumber(from);
      const toVersion = versionNumber(to);
      if (isNaN(fromVersion) || isNaN(toVersion)) {
        throw new AppError(400, 'Both "from" and "to" query params are required as integers');
      }
      return wikiService.diffVersions(spaceId, pageSlug, fromVersion, toVersion);
    },
  }),
  defineAction({
    name: 'page.restore',
    area: 'wiki',
    kind: 'write',
    summary: 'Restore an earlier version of a page',
    target: slugTarget,
    input: slugTarget.extend(restoreVersionSchema.shape),
    output: record,
    rest: { method: 'POST', path: `${PAGE}/restore`, status: 200 },
    authorize: editBySlug,
    handler: async (ctx, { spaceId, pageSlug, version }) =>
      wikiService.restoreVersion(spaceId, pageSlug, version, ctx.userId),
  }),
  defineAction({
    name: 'page.pendingMerge',
    area: 'wiki',
    kind: 'read',
    summary: 'The change waiting for the live editing session to merge, if any',
    input: slugTarget,
    output: loose.nullable(),
    rest: { method: 'GET', path: `${PAGE}/pending-merge` },
    // A read in what it does, but the route asked for EDIT and the page's edit check
    authorize: editBySlug,
    handler: async (ctx, { spaceId, pageSlug }) => {
      const merge = await wikiService.getPagePendingMerge(spaceId, pageSlug, ctx.userId);
      return merge && { ...merge };
    },
  }),
  defineAction({
    name: 'page.applyMerge',
    area: 'wiki',
    kind: 'write',
    summary: 'Apply the merge of a pending change into the page',
    target: slugTarget,
    input: slugTarget.extend(applyMergeSchema.shape),
    output: nothing,
    rest: { method: 'POST', path: `${PAGE}/merge`, status: 204 },
    authorize: editBySlug,
    handler: async (ctx, { spaceId, pageSlug, ...data }) => {
      await wikiService.applyPageMerge(spaceId, pageSlug, ctx.userId, data);
    },
  }),
  defineAction({
    name: 'page.move',
    area: 'wiki',
    kind: 'write',
    summary: 'Move a page to another parent or space',
    target: pageTarget,
    input: pageTarget.extend(movePageSchema.shape),
    output: record,
    rest: { method: 'POST', path: `${PAGE_BY_ID}/move`, status: 200 },
    authorize: editPage,
    handler: async (ctx, { pageId, targetSpaceId, targetParentId }) => {
      await assertPageDestinationWritable(ctx.userId, pageId, targetSpaceId, targetParentId);
      return wikiService.movePage(pageId, targetSpaceId, targetParentId, ctx.userId);
    },
  }),
  defineAction({
    name: 'page.copy',
    area: 'wiki',
    kind: 'write',
    summary: 'Copy a page, to the same space or another',
    target: pageTarget,
    input: pageTarget.extend(copyPageSchema.shape),
    output: record,
    rest: { method: 'POST', path: `${PAGE_BY_ID}/copy` },
    authorize: viewPage,
    handler: async (ctx, { pageId, targetSpaceId, newSlug }) => {
      await assertPageDestinationWritable(ctx.userId, pageId, targetSpaceId, undefined);
      return wikiService.copyPage(pageId, ctx.userId, targetSpaceId, newSlug);
    },
  }),
  defineAction({
    name: 'page.reorder',
    area: 'wiki',
    kind: 'write',
    summary: 'Put a page at a position under a parent',
    target: pageTarget,
    input: pageTarget.extend(reorderPageSchema.shape),
    output: loose,
    rest: { method: 'PATCH', path: `${PAGE_BY_ID}/reorder` },
    authorize: editPage,
    handler: async (ctx, { pageId, parentId, position }) => {
      await assertPageDestinationWritable(ctx.userId, pageId, undefined, parentId);
      return wikiService.reorderPage(pageId, parentId, position);
    },
  }),
];

const linkActions = [
  defineAction({
    name: 'pageIssueLink.list',
    area: 'wiki',
    kind: 'read',
    summary: 'The issues linked to a page that the caller may open',
    input: pageTarget,
    output: list,
    rest: { method: 'GET', path: `${PAGE_BY_ID}/linked-issues` },
    authorize: viewPage,
    handler: async (ctx, { pageId }) => linkService.getLinksForPage(pageId, ctx.userId),
  }),
  defineAction({
    name: 'pageIssueLink.add',
    area: 'wiki',
    kind: 'write',
    summary: 'Link an issue to a page, as an embed or a mention',
    target: pageTarget,
    // A wrong or missing value reads as '', and the handler gives the message the route always gave
    input: pageTarget.extend({
      issueId: z.string().catch(''),
      linkType: z.enum(['EMBED', 'MENTION', '']).catch(''),
    }),
    output: record,
    rest: { method: 'POST', path: `${PAGE_BY_ID}/linked-issues` },
    authorize: editPage,
    handler: async (ctx, { pageId, issueId, linkType }) => {
      if (!issueId || (linkType !== 'EMBED' && linkType !== 'MENTION')) {
        throw new AppError(400, 'issueId and a linkType of EMBED or MENTION are required');
      }
      return linkService.addLinkForUser(pageId, issueId, linkType, ctx.userId);
    },
  }),
  defineAction({
    name: 'pageIssueLink.remove',
    area: 'wiki',
    kind: 'write',
    summary: 'Remove the embed link between an issue and a page',
    input: pageTarget.extend({ issueId: z.string() }),
    output: nothing,
    rest: { method: 'DELETE', path: `${PAGE_BY_ID}/linked-issues/:issueId` },
    authorize: editPage,
    handler: async (_ctx, { pageId, issueId }) => {
      await linkService.removeEmbedLink(pageId, issueId);
    },
  }),
];

registerActions([...spaceActions, ...pageActions, ...linkActions]);
