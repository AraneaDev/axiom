import fs from 'fs/promises';
import type { Readable } from 'stream';
import { pipeline } from 'stream/promises';

import type { Response } from 'express';
import { z } from 'zod';

import { pageBySlugAccess, projectAction } from '../../actions/authorize';
import { defineAction, type ActionContext } from '../../actions/define';
import { MAX_KEY_LENGTH, parseKey, resolveKey } from '../../actions/keys';
import {
  orgsOfAttachment,
  orgsOfComments,
  orgsOfProjects,
  orgsOfSpaces,
  orgsOfUser,
} from '../../actions/org-lookups';
import * as previews from '../../actions/previews';
import { registerActions } from '../../actions/registry';
import { AppError } from '../../middleware/errorHandler';
import { logger } from '../../utils/logger';
import { MAX_DB_INT, validate } from '../../utils/validation/common-validators';
import { assertRawNotNamed, orgIdsOfInput } from '../agent-approvals/agent-policy.service';

import { receiveMultipart } from './attachments.routes';
import * as attachmentsService from './attachments.service';
import * as uploadIntents from './upload-intents.service';

// Responses keep the shape the REST routes always had (R3)
const record = z.looseObject({ id: z.string() });
const nothing = z.void();

const BASE = '/api/attachments';

// Authorization runs on the ids alone (R10); every input extends its target (R11)
const idTarget = z.object({ id: z.string() });
const listTarget = z.object({ issueId: z.string().optional(), pageId: z.string().optional() });

const issueRef = z.strictObject({
  projectId: z.string().min(1),
  issueNumber: z.number().int().positive().max(MAX_DB_INT),
});
const pageRef = z.strictObject({ spaceId: z.string().min(1), pageSlug: z.string().min(1) });
const keyValue = z.string().min(1).max(MAX_KEY_LENGTH);
const issueKeyRef = z.strictObject({ issueKey: keyValue });
const pageKeyRef = z.strictObject({ pageKey: keyValue });
/** Where a new file goes, by ids or by key; without a target it is staged. */
const uploadTarget = z.object({
  target: z.union([issueRef, pageRef, issueKeyRef, pageKeyRef]).optional(),
});

type IssueRef = z.infer<typeof issueRef>;
type PageRef = z.infer<typeof pageRef>;
type UploadTargetInput = NonNullable<z.infer<typeof uploadTarget>['target']>;

const writeIssueRef = projectAction<IssueRef>('issue:edit', (ref) => ref.projectId);
const writePageRef = pageBySlugAccess<PageRef>(
  'EDIT',
  'edit',
  (ref) => ref.spaceId,
  (ref) => ref.pageSlug,
);

/**
 * The scope of an attachment's parent, for an action on a stored attachment (R1).
 * @param ctx - Who runs the action
 * @param id - The attachment's id
 * @param write - Whether the action writes
 */
async function assertStoredParentScope(
  ctx: ActionContext,
  id: string,
  write: boolean,
): Promise<void> {
  if (!ctx.scopes) return;
  const parent = await attachmentsService.getAttachmentParent(id);
  attachmentsService.assertParentScope(ctx.scopes, parent, write);
}

/**
 * Read a stored attachment: the parent's scope, then access to it.
 * @param ctx - Who runs the action
 * @param input - The id
 * @param input.id
 */
async function readAttachment(ctx: ActionContext, { id }: { id: string }): Promise<void> {
  await assertStoredParentScope(ctx, id, false);
  await attachmentsService.getAttachmentAuthorized(id, ctx.userId);
}

/**
 * The ids a target names. A key the user can't see answers 404 as resolveKey does, also where the
 * id form answers 403: a key doesn't tell what exists.
 * @param target - The target, by ids or by key
 * @param userId - Who asks
 * @throws {AppError} 400 when a key names the other kind of item, and what resolveKey throws
 */
async function targetIds(target: UploadTargetInput, userId: string): Promise<IssueRef | PageRef> {
  if ('projectId' in target || 'spaceId' in target) return target;
  const [key, kind] = 'issueKey' in target ? [target.issueKey, 'issue'] : [target.pageKey, 'page'];
  if (parseKey(key).kind !== kind) {
    throw new AppError(400, `This key does not name ${kind === 'issue' ? 'an issue' : 'a page'}`);
  }
  const resolved = await resolveKey(key, userId);
  return resolved.kind === 'issue'
    ? { projectId: resolved.projectId, issueNumber: resolved.issueNumber }
    : { spaceId: resolved.spaceId, pageSlug: resolved.pageSlug };
}

/**
 * The ids authorize checked, per run of an action, so the handler acts on those: a key resolved a
 * second time could name something else by then (R11).
 */
const authorizedTargets = new WeakMap<ActionContext, IssueRef | PageRef>();

/**
 * The orgs of the parent a multipart upload names, or undefined when it names none (staged).
 * @param fields - The validated multipart fields
 * @param fields.issueId
 * @param fields.pageId
 * @param fields.commentId
 */
async function orgsOfParent(fields: {
  issueId?: string;
  pageId?: string;
  commentId?: string;
}): Promise<string[] | undefined> {
  if (!fields.issueId && !fields.pageId && !fields.commentId) return undefined;
  const [named, comments] = await Promise.all([
    orgIdsOfInput({ issueId: fields.issueId, pageId: fields.pageId }),
    orgsOfComments(fields.commentId ? [fields.commentId] : []),
  ]);
  return [...named, ...comments];
}

/**
 * The org of the issue or page a new file goes to: the ids authorize resolved, so a key counts
 * as the item it names. A staged file has no parent yet, so it takes every org of the user.
 * @param ctx - Who runs the action
 */
async function uploadTargetOrgs(ctx: ActionContext): Promise<string[]> {
  const target = authorizedTargets.get(ctx);
  // A staged file attaches later, wherever the user can: every org of theirs counts
  if (!target) return orgsOfUser(ctx.userId);
  return 'projectId' in target
    ? orgsOfProjects([target.projectId])
    : orgsOfSpaces([target.spaceId]);
}

/**
 * Attach a new file to a target: the parent's scope, then edit access to it. Without a target
 * there is no parent to check; the file is the user's own until a body write binds it.
 * @param ctx - Who runs the action
 * @param input - The target
 * @param input.target
 */
async function writeTarget(
  ctx: ActionContext,
  { target }: z.infer<typeof uploadTarget>,
): Promise<void> {
  authorizedTargets.delete(ctx);
  if (!target) return;
  const issue = 'projectId' in target || 'issueKey' in target;
  attachmentsService.assertParentAreaScope(ctx.scopes, issue ? 'issues' : 'wiki', true);
  const ids = await targetIds(target, ctx.userId);
  if ('projectId' in ids) await writeIssueRef(ctx, ids);
  else await writePageRef(ctx, ids);
  authorizedTargets.set(ctx, ids);
}

/**
 * Answer with a file in pieces, so that it isn't held in memory. Once it has started there is no
 * error to answer with: the connection just ends, which a client sees as an incomplete download.
 * @param res - The response, with its other headers set
 * @param stream - The file
 * @param size - Its size in bytes
 */
async function sendStream(res: Response, stream: Readable, size: number): Promise<void> {
  res.setHeader('Content-Length', size);
  await pipeline(stream, res).catch((err: NodeJS.ErrnoException) => {
    if (err.code !== 'ERR_STREAM_PREMATURE_CLOSE') {
      logger.warn('attachment stream failed', { code: err.code });
    }
  });
}

/**
 * The raw request and response of a raw binding.
 * @param ctx - Who runs the action
 */
function httpOf(ctx: ActionContext) {
  if (!ctx.http) throw new AppError(400, 'This action is only available over REST', 'RAW_ACTION');
  return ctx.http;
}

/** Where a new file went, for its audit row: the target field holds the ids or the key. */
const UPLOAD_AUDIT_INPUT = [
  'target.projectId',
  'target.issueNumber',
  'target.spaceId',
  'target.pageSlug',
  'target.issueKey',
  'target.pageKey',
  'filename',
];

/** An id in a multipart field. This body isn't parsed when the /api NUL guard runs. */
const multipartId = z
  .string()
  .min(1)
  .refine((value) => !value.includes('\u0000'), 'must not contain a NUL character')
  .optional();

/** The fields of a multipart upload. Empty and repeated values can't name a parent. */
const multipartFields = z.object({
  issueId: multipartId,
  pageId: multipartId,
  commentId: multipartId,
});

const attachmentActions = [
  defineAction({
    name: 'attachment.upload',
    // The parent is in the multipart body, read after the gate: the handler checks the org rules
    // that name this action once it knows the parent (assertRawNotNamed)
    area: 'files',
    kind: 'write',
    summary:
      'Upload a file as multipart/form-data, on an issue or page. Without one the file is staged.',
    // Nothing to authorize on yet: the ids are in the multipart body, which is parsed in the
    // handler. The handler authorizes on them there, and removes the file when refused.
    target: z.object({}),
    input: multipartFields,
    output: nothing,
    rest: { method: 'POST', path: BASE, raw: true },
    rawAlternative: 'Use the upload tool, or attachment.createUploadUrl.',
    authorize: async () => {},
    handler: async (ctx) => {
      const { req, res } = httpOf(ctx);
      await receiveMultipart(req, res);
      const file = req.file;
      try {
        const fields = validate(multipartFields, req.body ?? {});
        attachmentsService.assertParentScope(ctx.scopes, fields, true);
        // A rule that names this action binds it per parent; a staged file takes every org
        const parentOrgs = await orgsOfParent(fields);
        await assertRawNotNamed(
          ctx,
          'attachment.upload',
          parentOrgs ?? (await orgsOfUser(ctx.userId)),
        );
        if (!file) throw new AppError(400, 'No file provided', 'MISSING_FILE');
        if (file.originalname.includes('\u0000')) {
          throw new AppError(400, 'The file name may not contain a NUL character', 'INVALID_TEXT');
        }
        // Without a parent it is staged, as with the other ways in, so it doesn't stay forever
        const staged = !fields.issueId && !fields.pageId;
        const attachment = await attachmentsService.uploadAttachment(file, ctx.userId, {
          ...fields,
          staged,
        });
        res.status(201).json(attachment);
      } catch (err) {
        if (file) await fs.unlink(file.path).catch(() => {});
        throw err;
      }
    },
  }),
  defineAction({
    name: 'attachment.createUploadUrl',
    orgIds: uploadTargetOrgs,
    area: 'files',
    kind: 'write',
    summary:
      'Get a signed URL that takes one PUT of a file within 10 minutes. Without a target the ' +
      'file is staged: reference attachmentUrl in an issue, comment or page body after uploading.',
    target: uploadTarget,
    input: uploadTarget.extend({
      filename: z.string().min(1).max(attachmentsService.MAX_FILENAME_LENGTH),
      mimeType: z.string().min(1).max(255),
      size: z.number().int().positive(),
    }),
    auditFields: { input: UPLOAD_AUDIT_INPUT, result: ['uploadId'] },
    output: z.object({
      uploadUrl: z.string(),
      uploadId: z.string(),
      expiresAt: z.string(),
      attachmentUrl: z.string(),
    }),
    rest: { method: 'POST', path: `${BASE}/upload-url` },
    authorize: writeTarget,
    handler: async (ctx, input) =>
      uploadIntents.createUploadUrl(
        { userId: ctx.userId, apiTokenId: ctx.apiTokenId },
        { ...input, target: authorizedTargets.get(ctx) },
      ),
  }),
  defineAction({
    name: 'attachment.fromUrl',
    orgIds: uploadTargetOrgs,
    area: 'files',
    kind: 'write',
    summary:
      'Fetch a file from a public HTTPS URL into an attachment. Without a target it is staged.',
    target: uploadTarget,
    input: uploadTarget.extend({
      url: z.string().min(1).max(2048),
      filename: z.string().min(1).max(attachmentsService.MAX_FILENAME_LENGTH).optional(),
    }),
    auditFields: { input: [...UPLOAD_AUDIT_INPUT, 'url'] },
    output: record,
    rest: { method: 'POST', path: `${BASE}/from-url` },
    authorize: writeTarget,
    handler: async (ctx, input) =>
      uploadIntents.attachFromUrl(ctx.userId, {
        ...input,
        target: authorizedTargets.get(ctx),
      }),
  }),
  defineAction({
    name: 'attachment.list',
    area: 'files',
    kind: 'read',
    summary: 'List the attachments of an issue or a page',
    target: listTarget,
    input: listTarget,
    output: z.array(record),
    rest: { method: 'GET', path: BASE },
    authorize: async (ctx, parent) => {
      attachmentsService.assertParentScope(ctx.scopes, parent, false);
      await attachmentsService.assertAttachmentParentAccess(ctx.userId, parent, 'view');
    },
    handler: async (ctx, input) => attachmentsService.listAttachments(input, ctx.userId),
  }),
  defineAction({
    name: 'attachment.meta',
    area: 'files',
    kind: 'read',
    summary: 'Read the metadata of an attachment',
    input: idTarget,
    output: record,
    rest: { method: 'GET', path: `${BASE}/:id/meta` },
    authorize: readAttachment,
    handler: async (ctx, { id }) =>
      attachmentsService.toAttachmentView(
        await attachmentsService.getAttachmentAuthorized(id, ctx.userId),
      ),
  }),
  defineAction({
    name: 'attachment.preview',
    area: 'files',
    kind: 'read',
    summary: 'Preview an attachment: images redirect to the download, documents render as HTML',
    input: idTarget,
    output: nothing,
    rest: { method: 'GET', path: `${BASE}/:id/preview`, raw: true },
    rawAlternative: 'Use attachment.convert for its text, or GET the file over HTTP.',
    authorize: readAttachment,
    handler: async (ctx, { id }) => {
      const { res } = httpOf(ctx);
      const result = await attachmentsService.preview(id, ctx.userId);
      if (result.type === 'redirect') {
        res.redirect(`/api/attachments/${id}`);
      } else if (result.type === 'file') {
        res.setHeader('Content-Type', result.mimeType);
        await sendStream(res, result.stream!, result.size!);
      } else {
        res.setHeader('Content-Type', result.mimeType);
        res.send(result.content);
      }
    },
  }),
  defineAction({
    name: 'attachment.convert',
    area: 'files',
    kind: 'read',
    summary: 'Convert a document attachment to Markdown',
    input: idTarget,
    output: z.looseObject({ markdown: z.string(), originalName: z.string() }),
    rest: { method: 'GET', path: `${BASE}/:id/convert` },
    authorize: readAttachment,
    handler: async (ctx, { id }) => attachmentsService.convertToMarkdown(id, ctx.userId),
  }),
  defineAction({
    name: 'attachment.download',
    area: 'files',
    kind: 'read',
    summary: 'Download the file of an attachment',
    input: idTarget,
    output: nothing,
    rest: { method: 'GET', path: `${BASE}/:id`, raw: true },
    rawAlternative: 'Use attachment.convert for its text, or GET the file over HTTP.',
    authorize: readAttachment,
    handler: async (ctx, { id }) => {
      const { res } = httpOf(ctx);
      const { attachment, stream, size } = await attachmentsService.downloadAttachment(
        id,
        ctx.userId,
      );
      res.setHeader('Content-Type', attachment.mimeType);
      res.setHeader(
        'Content-Disposition',
        `inline; filename="${encodeURIComponent(attachment.originalName)}"`,
      );
      await sendStream(res, stream, size);
    },
  }),
  defineAction({
    name: 'attachment.delete',
    orgIds: (_ctx, { id }) => orgsOfAttachment(id),
    destructive: true,
    area: 'files',
    kind: 'write',
    summary: 'Delete an attachment you uploaded',
    input: idTarget,
    output: nothing,
    rest: { method: 'DELETE', path: `${BASE}/:id` },
    preview: (_ctx, { id }) => previews.attachmentDelete(id),
    authorize: async (ctx, { id }) => {
      await assertStoredParentScope(ctx, id, true);
      await attachmentsService.getDeletableAttachment(id, ctx.userId);
    },
    handler: async (ctx, { id }) => attachmentsService.deleteAttachment(id, ctx.userId),
  }),
];

registerActions(attachmentActions);
