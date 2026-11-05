import { z } from 'zod';

import { pageAccess, pageBySlugAccess, spaceAccess, teamPermission } from '../../actions/authorize';
import { defineAction, type ActionContext } from '../../actions/define';
import { listWindow, pagedList } from '../../actions/paging';
import { registerActions } from '../../actions/registry';
import { AppError } from '../../middleware/errorHandler';
import { checkWikiSpaceOrgAccess } from '../../middleware/rbac';
import { checkProjectAccess } from '../../middleware/requireProjectAccess';
import { ERR } from '../../utils/error-messages';
import {
  applyMergeSchema,
  copyPageSchema,
  createPageSchema,
  firstQueryText,
  flushPageSessionSchema,
  MAX_DB_INT,
  movePageSchema,
  queryCount,
  reorderPageSchema,
  restoreVersionSchema,
  updatePageSchema,
} from '../../utils/validation';

import { assertPageDestinationWritable } from './page-destination';
import { canAccessSpace } from './space-permissions.service';
import { hydrateWikiPage } from './wiki-hydrate.service';
import * as linkService from './wiki-issue-links.service';
import { hiddenPageIds, pruneHiddenPages } from './wiki-permissions.service';
import { bodyFromTemplate, resolveWikiTemplate } from './wiki-template-resolver.service';
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

/**
 * Whether a version number can be looked up at all. Past the column it would be a failed query.
 * @param version - The number read from the query
 */
function isVersionNumber(version: number): boolean {
  return Number.isInteger(version) && Math.abs(version) <= MAX_DB_INT;
}

/** The ids a template's variables read. A team id may come along; nothing reads it. */
const resolveTemplateTarget = z.object({
  context: z.object({ spaceId: z.string(), projectId: z.string().optional() }),
});

/**
 * Resolving a template reads the names of the space and project: the user must be able to open them.
 * @param ctx - Who runs the action
 * @param target - The space, and optionally the project
 */
async function authorizeResolveTemplate(
  ctx: ActionContext,
  target: z.infer<typeof resolveTemplateTarget>,
): Promise<void> {
  const { spaceId, projectId } = target.context;
  const space = await checkWikiSpaceOrgAccess(spaceId, ctx.userId);
  if (space === 'not_found') throw new AppError(404, ERR.SPACE_NOT_FOUND);
  if (space === 'forbidden' || !(await canAccessSpace(spaceId, ctx.userId, 'VIEW'))) {
    throw new AppError(403, 'You do not have access to this space');
  }
  if (!projectId) return;
  const project = await checkProjectAccess(ctx.userId, projectId);
  if (project === 'not_found') throw new AppError(404, ERR.PROJECT_NOT_FOUND);
  if (project === 'forbidden') throw new AppError(403, ERR.ACCESS_DENIED, 'FORBIDDEN');
}

const templateActions = [
  defineAction({
    name: 'pageTemplate.resolve',
    area: 'wiki',
    // A POST under /api/wiki, which only a wiki:write token has ever reached (R7)
    kind: 'write',
    summary: 'Fill in the {{variables}} of a template text for a space',
    target: resolveTemplateTarget,
    input: resolveTemplateTarget.extend({ body: z.string() }),
    auditFields: { input: ['context.spaceId', 'context.projectId'] },
    output: z.looseObject({ body: z.string() }),
    rest: { method: 'POST', path: `${WIKI}/resolve-template`, status: 200 },
    authorize: authorizeResolveTemplate,
    handler: async (ctx, { body, context: { spaceId, projectId } }) => ({
      body: await resolveWikiTemplate(body, {
        teamId: '',
        spaceId,
        projectId,
        userId: ctx.userId,
      }),
    }),
  }),
];

const spaceActions = [
  defineAction({
    name: 'space.list',
    area: 'wiki',
    kind: 'read',
    summary:
      'List the wiki spaces of a team: all of them, or with limit (1 to 100) and offset a page as ' +
      '{ data, total, limit, offset }.',
    target: teamTarget,
    // Anything but true or the string 'true' reads as false, as it always did
    input: teamTarget.extend({
      includeArchived: z.union([z.boolean(), z.string()]).optional(),
      limit: queryCount,
      offset: queryCount,
    }),
    output: z.union([list, z.looseObject({ data: list, total: z.number() })]),
    rest: { method: 'GET', path: `${WIKI}/team/:teamId/spaces` },
    authorize: inTeam,
    handler: async (ctx, { teamId, includeArchived, limit, offset }) => {
      const spaces = await wikiService.listSpaces(
        teamId,
        includeArchived === true || includeArchived === 'true',
        ctx.userId,
      );
      const window = listWindow(firstQueryText(limit), firstQueryText(offset));
      if (!window) return spaces;
      const data = spaces.slice(window.skip, window.skip + window.take);
      return pagedList(data, spaces.length, window);
    },
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
    summary: 'Create a page in a space, with a body or from a template (templateId)',
    target: spaceTarget,
    input: spaceTarget.extend(createPageSchema.shape).extend({
      templateId: z.string().min(1).optional(),
    }),
    output: record,
    rest: { method: 'POST', path: `${SPACE}/pages` },
    authorize: editSpace,
    handler: async (ctx, { spaceId, templateId, ...data }) => {
      if (templateId === undefined) return wikiService.createPage(spaceId, ctx.userId, data);
      if (data.body) throw new AppError(400, 'Give body or templateId, not both');
      const body = await bodyFromTemplate(templateId, spaceId, ctx.userId);
      return wikiService.createPage(spaceId, ctx.userId, { ...data, body });
    },
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
    destructive: true,
    area: 'wiki',
    kind: 'write',
    summary: 'Delete a page',
    input: slugTarget,
    output: nothing,
    rest: { method: 'DELETE', path: PAGE },
    preview: (_ctx, { spaceId, pageSlug }) => wikiService.deletePagePreview(spaceId, pageSlug),
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
      if (!isVersionNumber(fromVersion) || !isVersionNumber(toVersion)) {
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
    auditFields: { input: ['version'] },
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
    name: 'page.flush',
    area: 'wiki',
    kind: 'write',
    summary: 'Save a page from its live editing session now, with an optional change description',
    target: slugTarget,
    input: slugTarget.extend(flushPageSessionSchema.shape),
    output: z.looseObject({ flushed: z.boolean() }),
    rest: { method: 'POST', path: `${PAGE}/collab/flush`, status: 200, optionalBody: true },
    authorize: editBySlug,
    handler: async (ctx, { spaceId, pageSlug, changeDescription }) =>
      wikiService.flushPageSession(
        spaceId,
        pageSlug,
        ctx.userId,
        changeDescription?.trim() || undefined,
      ),
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
    crossContainer: (_ctx, { pageId, targetSpaceId, targetParentId }) =>
      wikiService.moveCrossesSpace(pageId, targetSpaceId, targetParentId),
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
      linkType: z.enum(['EMBED', 'MENTION']).catch('' as 'EMBED'),
    }),
    output: record,
    rest: { method: 'POST', path: `${PAGE_BY_ID}/linked-issues` },
    authorize: editPage,
    handler: async (ctx, { pageId, issueId, linkType }) => {
      if (!issueId || !linkType) {
        throw new AppError(400, 'issueId and a linkType of EMBED or MENTION are required');
      }
      return linkService.addLinkForUser(pageId, issueId, linkType, ctx.userId);
    },
  }),
  defineAction({
    name: 'pageIssueLink.remove',
    destructive: true,
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

registerActions([...templateActions, ...spaceActions, ...pageActions, ...linkActions]);
