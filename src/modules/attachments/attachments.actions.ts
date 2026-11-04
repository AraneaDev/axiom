import fs from 'fs/promises';

import { z } from 'zod';

import { pageBySlugAccess, projectAction } from '../../actions/authorize';
import { defineAction, type ActionContext } from '../../actions/define';
import { registerActions } from '../../actions/registry';
import { AppError } from '../../middleware/errorHandler';
import { validate } from '../../utils/validation/common-validators';

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
  issueNumber: z.number().int().positive(),
});
const pageRef = z.strictObject({ spaceId: z.string().min(1), pageSlug: z.string().min(1) });
/** Where a new file goes; without a target it is staged. */
const uploadTarget = z.object({ target: z.union([issueRef, pageRef]).optional() });

type IssueRef = z.infer<typeof issueRef>;
type PageRef = z.infer<typeof pageRef>;

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
  if (!target) return;
  if ('projectId' in target) {
    attachmentsService.assertParentAreaScope(ctx.scopes, 'issues', true);
    await writeIssueRef(ctx, target);
  } else {
    attachmentsService.assertParentAreaScope(ctx.scopes, 'wiki', true);
    await writePageRef(ctx, target);
  }
}

/**
 * The raw request and response of a raw binding.
 * @param ctx - Who runs the action
 */
function httpOf(ctx: ActionContext) {
  if (!ctx.http) throw new AppError(400, 'This action is only available over REST', 'RAW_ACTION');
  return ctx.http;
}

/** The fields of a multipart upload. Empty and repeated values can't name a parent. */
const multipartFields = z.object({
  issueId: z.string().min(1).optional(),
  pageId: z.string().min(1).optional(),
  commentId: z.string().min(1).optional(),
});

const attachmentActions = [
  defineAction({
    name: 'attachment.upload',
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
    authorize: async () => {},
    handler: async (ctx) => {
      const { req, res } = httpOf(ctx);
      await receiveMultipart(req, res);
      const file = req.file;
      try {
        const fields = validate(multipartFields, req.body ?? {});
        attachmentsService.assertParentScope(ctx.scopes, fields, true);
        if (!file) throw new AppError(400, 'No file provided', 'MISSING_FILE');
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
    output: z.object({
      uploadUrl: z.string(),
      uploadId: z.string(),
      expiresAt: z.string(),
      attachmentUrl: z.string(),
    }),
    rest: { method: 'POST', path: `${BASE}/upload-url` },
    authorize: writeTarget,
    handler: async (ctx, input) =>
      uploadIntents.createUploadUrl({ userId: ctx.userId, apiTokenId: ctx.apiTokenId }, input),
  }),
  defineAction({
    name: 'attachment.fromUrl',
    area: 'files',
    kind: 'write',
    summary:
      'Fetch a file from a public HTTPS URL into an attachment. Without a target it is staged.',
    target: uploadTarget,
    input: uploadTarget.extend({
      url: z.string().min(1).max(2048),
      filename: z.string().min(1).max(attachmentsService.MAX_FILENAME_LENGTH).optional(),
    }),
    output: record,
    rest: { method: 'POST', path: `${BASE}/from-url` },
    authorize: writeTarget,
    handler: async (ctx, input) => uploadIntents.attachFromUrl(ctx.userId, input),
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
    handler: async (ctx, { id }) => attachmentsService.getAttachmentAuthorized(id, ctx.userId),
  }),
  defineAction({
    name: 'attachment.preview',
    area: 'files',
    kind: 'read',
    summary: 'Preview an attachment: images redirect to the download, documents render as HTML',
    input: idTarget,
    output: nothing,
    rest: { method: 'GET', path: `${BASE}/:id/preview`, raw: true },
    authorize: readAttachment,
    handler: async (ctx, { id }) => {
      const { res } = httpOf(ctx);
      const result = await attachmentsService.preview(id, ctx.userId);
      if (result.type === 'redirect') {
        res.redirect(`/api/attachments/${id}`);
      } else if (result.type === 'pdf') {
        res.setHeader('Content-Type', 'application/pdf');
        res.send(result.content);
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
    authorize: readAttachment,
    handler: async (ctx, { id }) => {
      const { res } = httpOf(ctx);
      const { attachment, data } = await attachmentsService.downloadAttachment(id, ctx.userId);
      res.setHeader('Content-Type', attachment.mimeType);
      res.setHeader('Content-Length', data.length);
      res.setHeader(
        'Content-Disposition',
        `inline; filename="${encodeURIComponent(attachment.originalName)}"`,
      );
      res.send(data);
    },
  }),
  defineAction({
    name: 'attachment.delete',
    area: 'files',
    kind: 'write',
    summary: 'Delete an attachment you uploaded',
    input: idTarget,
    output: nothing,
    rest: { method: 'DELETE', path: `${BASE}/:id` },
    authorize: async (ctx, { id }) => {
      await assertStoredParentScope(ctx, id, true);
      await attachmentsService.getDeletableAttachment(id, ctx.userId);
    },
    handler: async (ctx, { id }) => attachmentsService.deleteAttachment(id, ctx.userId),
  }),
];

registerActions(attachmentActions);
