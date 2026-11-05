import { z } from 'zod';

import { ownedByProject, projectAction, projectRead } from '../../actions/authorize';
import { defineAction, type ActionContext } from '../../actions/define';
import { registerActions } from '../../actions/registry';
import { AppError } from '../../middleware/errorHandler';
import { checkProjectAccess, projectOf } from '../../middleware/requireProjectAccess';
import { ERR } from '../../utils/error-messages';
import { parseServicePagination } from '../../utils/pagination';
import {
  bulkUpdateIssuesSchema,
  createCommentSchema,
  createIssueSchema,
  dbInt,
  firstQueryText,
  issueListQuerySchema,
  issueWebLinkSchema,
  logWorkSchema,
  queryCount,
  strictInt,
  updateIssueSchema,
} from '../../utils/validation';
import * as wikiLinkService from '../wiki/wiki-issue-links.service';

import * as linksService from './issue-links.service';
import * as votesService from './issue-votes.service';
import * as watchersService from './issue-watchers.service';
import * as webLinksService from './issue-web-links.service';
import * as hydrateService from './issues-hydrate.service';
import * as issuesService from './issues.service';

// Responses keep the shape the REST routes always had (R3): the output schemas name the key
// fields and pass the rest through
const record = z.looseObject({ id: z.string() });
const loose = z.looseObject({});
const nothing = z.void();

const PROJECT = '/api/projects/:projectId';
const ISSUE = `${PROJECT}/issues/:issueNumber`;

// Authorization runs on the ids alone (R10), so a refused caller keeps today's 403/404 whatever
// the rest of the input holds, an issue number included. Every input extends its target (R11).
const projectTarget = z.object({ projectId: z.string() });
const issueInput = projectTarget.extend({ issueNumber: strictInt });
const commentTarget = projectTarget.extend({ commentId: z.string() });
const linkTarget = projectTarget.extend({ linkId: z.string() });

type ProjectInput = z.infer<typeof projectTarget>;

const read = projectRead<ProjectInput>((input) => input.projectId);
const ownsComment = ownedByProject(
  projectOf.comment,
  (input: z.infer<typeof commentTarget>) => ({
    projectId: input.projectId,
    recordId: input.commentId,
  }),
  'issue:edit',
);
const write = projectAction<ProjectInput>('issue:edit', (input) => input.projectId);

/**
 * Whoever comes through the REST adapter on a raw binding has the response in the context.
 * @param ctx - Who runs the action
 */
function responseOf(ctx: ActionContext) {
  if (!ctx.http) throw new AppError(400, 'This action is only available over REST', 'RAW_ACTION');
  return ctx.http.res;
}

const issueActions = [
  defineAction({
    name: 'issue.create',
    area: 'issues',
    kind: 'write',
    summary: 'Create an issue in a project',
    target: projectTarget,
    input: projectTarget.extend(createIssueSchema.shape),
    auditFields: { result: ['number'] },
    output: record,
    rest: { method: 'POST', path: `${PROJECT}/issues` },
    authorize: write,
    handler: async (ctx, { projectId, ...data }) =>
      issuesService.createIssue(projectId, ctx.userId, data),
  }),
  defineAction({
    name: 'issue.list',
    area: 'issues',
    kind: 'read',
    summary: 'List the issues of a project, filtered and paged',
    target: projectTarget,
    input: projectTarget.extend(issueListQuerySchema.shape),
    output: z.looseObject({ issues: z.array(loose), total: z.number() }),
    rest: { method: 'GET', path: `${PROJECT}/issues` },
    authorize: read,
    handler: async (ctx, { projectId, ...query }) => {
      const { take, skip } = parseServicePagination(
        { limit: query.limit, offset: query.offset },
        25,
      );
      const result = await issuesService.listIssues(projectId, {
        q: query.q,
        type: query.type,
        priority: query.priority,
        assigneeId: query.assigneeId,
        columnId: query.columnId,
        sprintId: query.sprintId,
        label: query.label,
        limit: take,
        offset: skip,
        currentUserId: ctx.userId,
      });
      return { ...result, limit: take, offset: skip };
    },
  }),
  defineAction({
    name: 'issue.timeReport',
    area: 'issues',
    kind: 'read',
    summary: 'Time logged on the issues of a project',
    target: projectTarget,
    input: projectTarget,
    output: loose,
    rest: { method: 'GET', path: `${PROJECT}/time-report` },
    authorize: read,
    handler: async (_ctx, { projectId }) => issuesService.getTimeReport(projectId),
  }),
  // The static paths come ahead of :issueNumber, which would capture them
  defineAction({
    name: 'issue.export',
    area: 'issues',
    kind: 'read',
    summary: 'Export the issues of a project as CSV',
    target: projectTarget,
    input: projectTarget,
    output: nothing,
    rest: { method: 'GET', path: `${PROJECT}/issues/export`, raw: true },
    authorize: read,
    handler: async (ctx, { projectId }) => {
      const csv = await issuesService.exportIssuesCsv(projectId);
      const res = responseOf(ctx);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="issues.csv"');
      res.send(csv);
    },
  }),
  defineAction({
    name: 'issue.bulkUpdate',
    area: 'issues',
    kind: 'write',
    summary: 'Change several issues at once',
    target: projectTarget,
    input: projectTarget.extend(bulkUpdateIssuesSchema.shape),
    auditFields: { input: ['issueIds'] },
    output: loose,
    rest: { method: 'PATCH', path: `${PROJECT}/issues/bulk` },
    authorize: write,
    bulkCount: ({ issueIds }) => issueIds.length,
    handler: async (ctx, { projectId, issueIds, updates }) =>
      issuesService.bulkUpdate(projectId, issueIds, updates, ctx.userId),
  }),
  defineAction({
    name: 'issue.hydrateList',
    area: 'issues',
    kind: 'read',
    summary: 'The issue list view in one call: issues, columns, sprints, filters, fields',
    target: projectTarget,
    // The filters of issue.list. Paging stays as lenient as this route always read it
    input: projectTarget
      .extend(issueListQuerySchema.shape)
      .extend({ limit: queryCount, offset: queryCount }),
    output: loose,
    rest: { method: 'GET', path: `${PROJECT}/issues/hydrate` },
    authorize: read,
    handler: async (ctx, { projectId, limit, offset, ...rest }) => {
      const filters: Record<string, string> = {};
      for (const [key, value] of Object.entries(rest)) {
        if (typeof value === 'string') filters[key] = value;
      }
      const limitText = firstQueryText(limit);
      const offsetText = firstQueryText(offset);
      if (limitText) filters.limit = limitText;
      if (offsetText) filters.offset = offsetText;
      return hydrateService.hydrateIssuesList(projectId, filters, ctx.userId);
    },
  }),
  defineAction({
    name: 'issue.hydrate',
    area: 'issues',
    kind: 'read',
    summary: 'The issue detail view in one call',
    target: projectTarget,
    input: issueInput,
    output: loose,
    rest: { method: 'GET', path: `${ISSUE}/hydrate` },
    authorize: read,
    handler: async (ctx, { projectId, issueNumber }) =>
      hydrateService.hydrateIssueDetail(projectId, issueNumber, ctx.userId),
  }),
  defineAction({
    name: 'issue.get',
    area: 'issues',
    kind: 'read',
    summary: 'Read one issue',
    target: projectTarget,
    input: issueInput,
    output: record,
    rest: { method: 'GET', path: ISSUE },
    authorize: read,
    handler: async (_ctx, { projectId, issueNumber }) =>
      issuesService.getIssue(projectId, issueNumber),
  }),
  defineAction({
    name: 'issue.update',
    area: 'issues',
    kind: 'write',
    summary: 'Change fields of an issue. Move it with status (a column name) or columnId.',
    target: projectTarget,
    input: issueInput.extend(updateIssueSchema.shape).extend({
      status: z.string().min(1).max(255).optional(),
    }),
    output: record,
    rest: { method: 'PATCH', path: ISSUE },
    authorize: write,
    handler: async (ctx, { projectId, issueNumber, status, ...data }) => {
      if (status === undefined) {
        return issuesService.updateIssue(projectId, issueNumber, data, ctx.userId);
      }
      if (data.columnId !== undefined) {
        throw new AppError(400, 'Give status or columnId, not both');
      }
      const columnId = await issuesService.columnIdForStatus(projectId, status);
      return issuesService.updateIssue(projectId, issueNumber, { ...data, columnId }, ctx.userId);
    },
  }),
  defineAction({
    name: 'issue.delete',
    destructive: true,
    area: 'issues',
    kind: 'write',
    summary: 'Delete an issue',
    target: projectTarget,
    input: issueInput,
    output: nothing,
    rest: { method: 'DELETE', path: ISSUE },
    preview: (_ctx, { projectId, issueNumber }) =>
      issuesService.deleteIssuePreview(projectId, issueNumber),
    authorize: write,
    handler: async (ctx, { projectId, issueNumber }) => {
      await issuesService.deleteIssue(projectId, issueNumber, ctx.userId);
    },
  }),
  defineAction({
    name: 'issue.move',
    area: 'issues',
    kind: 'write',
    summary: 'Move an issue to a board column and position',
    target: projectTarget,
    input: issueInput.extend({ columnId: z.string(), position: dbInt.optional() }),
    output: record,
    rest: { method: 'PATCH', path: `${ISSUE}/move` },
    authorize: write,
    crossContainer: (_ctx, { projectId, columnId }) =>
      issuesService.columnInOtherProject(projectId, columnId),
    handler: async (_ctx, { projectId, issueNumber, columnId, position }) =>
      issuesService.moveIssue(projectId, issueNumber, columnId, position),
  }),
  defineAction({
    name: 'issue.setParent',
    area: 'issues',
    kind: 'write',
    summary: 'Set or clear the parent of an issue',
    target: projectTarget,
    input: issueInput.extend({ parentIssueNumber: strictInt.nullish() }),
    output: record,
    rest: { method: 'PATCH', path: `${ISSUE}/parent` },
    authorize: write,
    handler: async (_ctx, { projectId, issueNumber, parentIssueNumber }) =>
      issuesService.setParent(projectId, issueNumber, parentIssueNumber ?? null),
  }),
  defineAction({
    name: 'issue.children',
    area: 'issues',
    kind: 'read',
    summary: 'The child issues of an issue',
    target: projectTarget,
    input: issueInput,
    output: z.array(loose),
    rest: { method: 'GET', path: `${ISSUE}/children` },
    authorize: read,
    handler: async (_ctx, { projectId, issueNumber }) =>
      issuesService.getChildren(projectId, issueNumber),
  }),
  defineAction({
    name: 'issue.progress',
    area: 'issues',
    kind: 'read',
    summary: 'How far the children of an epic are',
    target: projectTarget,
    input: issueInput,
    output: loose,
    rest: { method: 'GET', path: `${ISSUE}/progress` },
    authorize: read,
    handler: async (_ctx, { projectId, issueNumber }) =>
      issuesService.getEpicProgress(projectId, issueNumber),
  }),
  defineAction({
    name: 'issue.wikiLinks',
    area: 'issues',
    kind: 'read',
    summary: 'The wiki pages linked to an issue',
    target: projectTarget,
    input: issueInput,
    output: z.array(loose),
    rest: { method: 'GET', path: `${ISSUE}/wiki-links` },
    authorize: read,
    handler: async (ctx, { projectId, issueNumber }) => {
      const issue = await wikiLinkService.findIssueByNumber(projectId, issueNumber);
      if (!issue) throw new AppError(404, ERR.ISSUE_NOT_FOUND);
      return wikiLinkService.getLinksForIssue(issue.id, ctx.userId);
    },
  }),
];

const commentActions = [
  defineAction({
    name: 'comment.add',
    area: 'issues',
    kind: 'write',
    summary: 'Comment on an issue',
    target: projectTarget,
    input: issueInput.extend(createCommentSchema.shape),
    output: record,
    rest: { method: 'POST', path: `${ISSUE}/comments` },
    authorize: write,
    handler: async (ctx, { projectId, issueNumber, body }) => {
      const issue = await issuesService.getIssue(projectId, issueNumber);
      return issuesService.addComment(issue.id, ctx.userId, body);
    },
  }),
  defineAction({
    name: 'comment.update',
    area: 'issues',
    kind: 'write',
    summary: 'Edit your own comment',
    target: commentTarget,
    // Anything but a string reads as '', so the handler gives the 400 'body is required' as before
    input: commentTarget.extend({ body: z.string().catch('') }),
    output: record,
    rest: { method: 'PATCH', path: `${PROJECT}/comments/:commentId` },
    authorize: ownsComment,
    handler: async (ctx, { commentId, body }) => {
      if (!body) throw new AppError(400, 'body is required');
      return issuesService.updateComment(commentId, ctx.userId, body);
    },
  }),
  defineAction({
    name: 'comment.delete',
    destructive: true,
    area: 'issues',
    kind: 'write',
    summary: 'Delete your own comment',
    target: commentTarget,
    input: commentTarget,
    output: nothing,
    rest: { method: 'DELETE', path: `${PROJECT}/comments/:commentId` },
    authorize: ownsComment,
    handler: async (ctx, { commentId }) => {
      await issuesService.deleteComment(commentId, ctx.userId);
    },
  }),
];

const worklogActions = [
  defineAction({
    name: 'worklog.add',
    area: 'issues',
    kind: 'write',
    summary: 'Log time on an issue',
    target: projectTarget,
    input: issueInput.extend(logWorkSchema.shape),
    output: loose,
    rest: { method: 'POST', path: `${ISSUE}/worklogs` },
    authorize: write,
    handler: async (ctx, { projectId, issueNumber, minutes, description }) =>
      issuesService.logWork(projectId, issueNumber, ctx.userId, minutes, description),
  }),
  defineAction({
    name: 'worklog.list',
    area: 'issues',
    kind: 'read',
    summary: 'The time logged on an issue',
    target: projectTarget,
    input: issueInput,
    output: z.array(loose),
    rest: { method: 'GET', path: `${ISSUE}/worklogs` },
    authorize: read,
    handler: async (_ctx, { projectId, issueNumber }) =>
      issuesService.getWorklogs(projectId, issueNumber),
  }),
];

const linkActions = [
  defineAction({
    name: 'issueLink.list',
    area: 'issues',
    kind: 'read',
    summary: 'The links between an issue and other issues',
    target: projectTarget,
    input: issueInput,
    output: z.array(loose),
    rest: { method: 'GET', path: `${ISSUE}/links` },
    authorize: read,
    handler: async (ctx, { projectId, issueNumber }) =>
      linksService.getLinks(projectId, issueNumber, ctx.userId),
  }),
  defineAction({
    name: 'issueLink.add',
    area: 'issues',
    kind: 'write',
    summary: 'Link an issue to another issue',
    target: projectTarget,
    input: issueInput.extend({
      targetProjectId: z.string(),
      targetIssueNumber: strictInt,
      type: z.enum(['BLOCKS', 'IS_BLOCKED_BY', 'RELATES_TO', 'DUPLICATES']),
    }),
    output: record,
    rest: { method: 'POST', path: `${ISSUE}/links` },
    authorize: write,
    handler: async (ctx, { projectId, issueNumber, ...link }) => {
      // The target issue must be one the user can open: a link shows its title
      if (link.targetProjectId !== projectId) {
        const access = await checkProjectAccess(ctx.userId, link.targetProjectId);
        if (access === 'not_found') throw new AppError(404, 'Target issue not found');
        if (access === 'forbidden') throw new AppError(403, ERR.ACCESS_DENIED, 'FORBIDDEN');
      }
      return linksService.addLink(projectId, issueNumber, link);
    },
  }),
  defineAction({
    name: 'issueLink.delete',
    destructive: true,
    area: 'issues',
    kind: 'write',
    summary: 'Remove a link between issues',
    target: linkTarget,
    input: linkTarget.extend({ issueNumber: strictInt }),
    output: nothing,
    rest: { method: 'DELETE', path: `${ISSUE}/links/:linkId` },
    authorize: ownedByProject(
      projectOf.issueLink,
      (input: z.infer<typeof linkTarget>) => ({
        projectId: input.projectId,
        recordId: input.linkId,
      }),
      'issue:edit',
    ),
    handler: async (_ctx, { linkId }) => {
      await linksService.deleteLink(linkId);
    },
  }),
];

// Voting and watching are personal: whoever can read the issue can do both, VIEWERs included
const personalActions = [
  defineAction({
    name: 'issueVote.toggle',
    area: 'issues',
    kind: 'write',
    summary: 'Vote for an issue, or take your vote back',
    target: projectTarget,
    input: issueInput,
    output: z.looseObject({ voted: z.boolean() }),
    rest: { method: 'POST', path: `${ISSUE}/votes/toggle`, status: 200, emptyBody: true },
    authorize: read,
    handler: async (ctx, { projectId, issueNumber }) =>
      votesService.toggleVote(projectId, issueNumber, ctx.userId),
  }),
  defineAction({
    name: 'issueVote.list',
    area: 'issues',
    kind: 'read',
    summary: 'The votes on an issue',
    target: projectTarget,
    input: issueInput,
    output: loose,
    rest: { method: 'GET', path: `${ISSUE}/votes` },
    authorize: read,
    handler: async (ctx, { projectId, issueNumber }) =>
      votesService.getVotes(projectId, issueNumber, ctx.userId),
  }),
  defineAction({
    name: 'issueWatch.toggle',
    area: 'issues',
    kind: 'write',
    summary: 'Watch an issue, or stop watching it',
    target: projectTarget,
    input: issueInput,
    output: z.looseObject({ watching: z.boolean() }),
    rest: { method: 'POST', path: `${ISSUE}/watchers/toggle`, status: 200, emptyBody: true },
    authorize: read,
    handler: async (ctx, { projectId, issueNumber }) =>
      watchersService.toggleWatch(projectId, issueNumber, ctx.userId),
  }),
  defineAction({
    name: 'issueWatch.list',
    area: 'issues',
    kind: 'read',
    summary: 'Who watches an issue, and whether you do',
    target: projectTarget,
    input: issueInput,
    output: z.looseObject({ watchers: z.array(loose), watching: z.boolean() }),
    rest: { method: 'GET', path: `${ISSUE}/watchers` },
    authorize: read,
    handler: async (ctx, { projectId, issueNumber }) => {
      const watchers = await watchersService.getWatchers(projectId, issueNumber);
      const watching = await watchersService.isWatching(projectId, issueNumber, ctx.userId);
      return { watchers, watching };
    },
  }),
];

const webLinkActions = [
  defineAction({
    name: 'issueWebLink.list',
    area: 'issues',
    kind: 'read',
    summary: 'The external links on an issue',
    target: projectTarget,
    input: issueInput,
    output: z.array(record),
    rest: { method: 'GET', path: `${ISSUE}/web-links` },
    authorize: read,
    handler: async (_ctx, { projectId, issueNumber }) =>
      webLinksService.listWebLinks(projectId, issueNumber),
  }),
  defineAction({
    name: 'issueWebLink.add',
    area: 'issues',
    kind: 'write',
    summary: 'Add an external http(s) link to an issue',
    target: projectTarget,
    input: issueInput.extend(issueWebLinkSchema.shape),
    output: record,
    rest: { method: 'POST', path: `${ISSUE}/web-links` },
    authorize: write,
    handler: async (ctx, { projectId, issueNumber, url, title }) =>
      webLinksService.addWebLink(projectId, issueNumber, ctx.userId, { url, title }),
  }),
  defineAction({
    name: 'issueWebLink.delete',
    destructive: true,
    area: 'issues',
    kind: 'write',
    summary: 'Remove an external link from an issue',
    target: linkTarget,
    input: linkTarget.extend({ issueNumber: strictInt }),
    output: nothing,
    rest: { method: 'DELETE', path: `${ISSUE}/web-links/:linkId` },
    authorize: ownedByProject(
      projectOf.issueWebLink,
      (input: z.infer<typeof linkTarget>) => ({
        projectId: input.projectId,
        recordId: input.linkId,
      }),
      'issue:edit',
    ),
    handler: async (_ctx, { projectId, issueNumber, linkId }) => {
      await webLinksService.deleteWebLink(projectId, issueNumber, linkId);
    },
  }),
];

registerActions([
  ...issueActions,
  ...commentActions,
  ...worklogActions,
  ...linkActions,
  ...personalActions,
  ...webLinkActions,
]);
