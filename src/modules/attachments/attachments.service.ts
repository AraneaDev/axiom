import { execFile } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { promisify } from 'util';

import { createId } from '@paralleldrive/cuid2';

import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { assertPageAccess } from '../../middleware/rbac';
import { checkProjectAccess, checkProjectAction } from '../../middleware/requireProjectAccess';
import { scopesCover } from '../../middleware/token-scopes';
import { getStorage } from '../../storage/storage';
import { ERR } from '../../utils/error-messages';
import { PROJECT_TEAM_ORG_INCLUDE, SPACE_TEAM_ORG_INCLUDE } from '../../utils/prisma-selects';
import { logActivity } from '../activity/activity.service';

import { removeTempFile } from './temp-files';

const execFileAsync = promisify(execFile);

/** The most an attachment can hold, whichever way it arrives. */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

const ALLOWED_MIME_PATTERNS = [
  /^image\//,
  /^application\/pdf$/,
  /^application\/msword$/,
  /^application\/vnd\.openxmlformats-officedocument\./,
  /^text\/plain$/,
  /^text\/csv$/,
  /^application\/zip$/,
  /^application\/x-tar$/,
  /^application\/gzip$/,
];

/** type/subtype and nothing else: the value ends up in a response header. */
const MIME_TOKEN = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/;

/**
 * Whether a file of this type may be stored.
 * @param mimeType - A bare type, without parameters
 */
export function isAllowedMimeType(mimeType: string): boolean {
  return MIME_TOKEN.test(mimeType) && ALLOWED_MIME_PATTERNS.some((re) => re.test(mimeType));
}

/**
 * The bare type of a Content-Type value.
 * @param contentType - A value such as `Image/PNG; charset=binary`
 */
export function bareMimeType(contentType: string): string {
  return contentType.split(';')[0].trim().toLowerCase();
}

/**
 * The refusal for a type that may not be stored.
 * @param mimeType - The type
 */
export function mimeTypeRefusal(mimeType: string): AppError {
  return new AppError(415, `File type ${mimeType} is not allowed`);
}

/** Staged files a user can hold at once, whichever way they arrived. */
export const MAX_STAGED_PER_USER = 100;

/**
 * Refuse a new staged file when the user holds as many as they may. Nobody else can see staged
 * files and they cost storage until the day is out, so this bounds what one user can pile up.
 * @param userId - The user
 * @throws {AppError} 429 STAGED_LIMIT
 */
export async function assertStagedQuota(userId: string): Promise<void> {
  const staged = await prisma.attachment.count({
    where: { uploaderId: userId, stagedAt: { not: null } },
  });
  if (staged >= MAX_STAGED_PER_USER) {
    throw new AppError(
      429,
      'Too many staged files: reference them in a body or delete them first',
      'STAGED_LIMIT',
    );
  }
}

/** The parent of an attachment, as far as it has one. */
export interface AttachmentParent {
  issueId?: string | null;
  pageId?: string | null;
}

/**
 * For API tokens: an attachment belongs to an issue or a page, so on top of the files scope the
 * token needs the issues or wiki scope that covers it (read to read, write to upload or delete).
 * A session has no scopes and passes.
 * @param scopes - The token's scopes, undefined for a session
 * @param area - The area of the parent
 * @param write - Whether the action writes
 * @throws {AppError} 403 SCOPE
 */
export function assertParentAreaScope(
  scopes: readonly string[] | undefined,
  area: 'issues' | 'wiki',
  write: boolean,
): void {
  if (scopes && !scopesCover(scopes, area, write)) {
    throw new AppError(403, 'This API token does not have the scope for this attachment', 'SCOPE');
  }
}

/**
 * The same for a parent by its ids, where either or both may be set.
 * @param scopes - The token's scopes, undefined for a session
 * @param parent - The attachment's parent
 * @param write - Whether the action writes
 * @throws {AppError} 403 SCOPE
 */
export function assertParentScope(
  scopes: readonly string[] | undefined,
  parent: AttachmentParent,
  write: boolean,
): void {
  if (parent.issueId) assertParentAreaScope(scopes, 'issues', write);
  if (parent.pageId) assertParentAreaScope(scopes, 'wiki', write);
}

/**
 * The parent of a stored attachment, empty when there is no such attachment: the action answers
 * 404 for that itself, once the scope has passed.
 * @param id - The attachment ID
 */
export async function getAttachmentParent(id: string): Promise<AttachmentParent> {
  return (
    (await prisma.attachment.findUnique({
      where: { id },
      select: { issueId: true, pageId: true },
    })) ?? {}
  );
}

const PANDOC_FORMAT_MAP: Record<string, string> = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.oasis.opendocument.text': 'odt',
  'application/epub+zip': 'epub',
  'text/html': 'html',
  'text/csv': 'csv',
  'text/x-rst': 'rst',
  'application/x-latex': 'latex',
  'text/x-latex': 'latex',
  'text/org': 'org',
};

/**
 * Build a storage key for an attachment.
 * Format: attachments/{year}/{month}/{cuid}.{ext}
 * @param originalName
 */
function buildStorageKey(originalName: string): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  // The name comes from the client: only plain characters reach the key
  const ext =
    path
      .extname(originalName)
      .slice(1)
      .replace(/[^a-zA-Z0-9]/g, '')
      .slice(0, 16) || 'bin';
  const id = createId();
  return `attachments/${year}/${month}/${id}.${ext}`;
}

/** A file on disk to store: from multer, a signed upload or a fetch. */
export interface IncomingFile {
  originalname: string;
  mimetype: string;
  size: number;
  path: string;
}

/**
 * Upload a file to storage and create the database record linking it to a resource.
 * A temp file on disk is gone afterwards, whatever the outcome.
 * @param file - The uploaded file
 * @param uploaderId - The user uploading the file
 * @param opts - Optional resource links (issueId, pageId, commentId)
 * @param opts.issueId
 * @param opts.pageId
 * @param opts.commentId
 * @param opts.id - The attachment's id, when one was reserved for it
 * @param opts.staged - Keep it without a parent until a body write references it
 * @returns The created attachment record
 */
export async function uploadAttachment(
  file: IncomingFile,
  uploaderId: string,
  opts: {
    issueId?: string;
    pageId?: string;
    commentId?: string;
    id?: string;
    staged?: boolean;
  },
) {
  try {
    // Attaching writes to the parent: refuse before storing anything
    await assertAttachmentParentAccess(uploaderId, opts, 'edit');
    // A comment attachment must name the comment's own issue
    if (opts.commentId) {
      const comment = await prisma.comment.findUnique({
        where: { id: opts.commentId },
        select: { issueId: true },
      });
      if (!comment || !opts.issueId || comment.issueId !== opts.issueId) {
        throw new AppError(400, 'The comment does not belong to this issue', 'BAD_REQUEST');
      }
    }

    if (opts.staged) await assertStagedQuota(uploaderId);

    const storageKey = buildStorageKey(file.originalname);
    const storage = getStorage();
    await storage.putFile(storageKey, file.path, file.mimetype);

    let attachment;
    try {
      attachment = await prisma.attachment.create({
        data: {
          ...(opts.id ? { id: opts.id } : {}),
          filename: path.basename(storageKey),
          originalName: file.originalname,
          mimeType: file.mimetype,
          size: file.size,
          storageKey,
          uploaderId,
          issueId: opts.issueId ?? null,
          pageId: opts.pageId ?? null,
          commentId: opts.commentId ?? null,
          stagedAt: opts.staged ? new Date() : null,
        },
      });
    } catch (err) {
      await storage.delete(storageKey).catch(() => {});
      throw err;
    }

    if (opts.issueId) {
      await logActivity('issue', opts.issueId, 'attachment_added', uploaderId, {
        attachmentId: attachment.id,
        fileName: file.originalname,
      });
    }

    return attachment;
  } finally {
    await removeTempFile(file.path);
  }
}

/**
 * Get attachment metadata by ID.
 * @param id - The attachment ID
 * @returns The attachment record
 * @throws {AppError} 404 if attachment not found
 */
export async function getAttachment(id: string) {
  const attachment = await prisma.attachment.findUnique({ where: { id } });
  if (!attachment) throw new AppError(404, ERR.ATTACHMENT_NOT_FOUND, 'NOT_FOUND');
  return attachment;
}

/**
 * Whether a user may see (or attach to) an attachment's parent, by the parent's own REST
 * rules: an issue needs project access; a page needs org membership, space access and the
 * page's restrictions (edit level to attach, view level to read).
 * @param userId - The user
 * @param parent - The parent issue or page
 * @param parent.issueId
 * @param parent.pageId
 * @param mode - 'view' to read, 'edit' to attach
 * @throws {AppError} 404 when the parent doesn't exist, 403 when access is refused
 */
export async function assertAttachmentParentAccess(
  userId: string,
  parent: { issueId?: string | null; pageId?: string | null },
  mode: 'view' | 'edit',
): Promise<void> {
  if (parent.issueId) {
    const issue = await prisma.issue.findUnique({
      where: { id: parent.issueId },
      select: { projectId: true },
    });
    if (!issue) throw new AppError(404, ERR.ISSUE_NOT_FOUND, 'NOT_FOUND');
    if ((await checkProjectAccess(userId, issue.projectId)) !== 'ok') {
      throw new AppError(403, ERR.ACCESS_DENIED, 'FORBIDDEN');
    }
    // Attaching changes the issue: the role must allow issue:edit
    if (
      mode === 'edit' &&
      (await checkProjectAction(userId, issue.projectId, 'issue:edit')) !== 'ok'
    ) {
      throw new AppError(403, 'Insufficient permissions: issue:edit', 'FORBIDDEN');
    }
  }
  if (parent.pageId) await assertPageAccess(userId, parent.pageId, mode);
}

/**
 * Get attachment with authorization check.
 * Verifies the requesting user has access to the attachment's parent resource.
 * @param id - The attachment ID
 * @param userId - The requesting user's ID
 * @returns The attachment record
 * @throws {AppError} 404 if not found, 403 if unauthorized
 */
export async function getAttachmentAuthorized(id: string, userId: string) {
  const attachment = await prisma.attachment.findUnique({
    where: { id },
    include: {
      issue: { include: PROJECT_TEAM_ORG_INCLUDE },
      page: { include: SPACE_TEAM_ORG_INCLUDE },
    },
  });
  if (!attachment) throw new AppError(404, ERR.ATTACHMENT_NOT_FOUND, 'NOT_FOUND');

  if (!attachment.issueId && !attachment.pageId) {
    // No parent to inherit access from: only the uploader may open it
    if (attachment.uploaderId !== userId) throw new AppError(403, ERR.ACCESS_DENIED, 'FORBIDDEN');
    return attachment;
  }
  await assertAttachmentParentAccess(userId, attachment, 'view');

  return attachment;
}

/**
 * List attachments for a given resource (issue or wiki page) with authorization check.
 * Verifies the requesting user belongs to the same org as the parent resource.
 * @param opts - Filter options by issueId and/or pageId
 * @param opts.issueId
 * @param opts.pageId
 * @param userId - The requesting user's ID
 * @returns List of attachment records
 * @throws {AppError} 400 if neither issueId nor pageId is provided
 * @throws {AppError} 403 if user does not have access to the parent resource
 */
export async function listAttachments(opts: { issueId?: string; pageId?: string }, userId: string) {
  if (!opts.issueId && !opts.pageId) {
    throw new AppError(400, 'issueId or pageId is required', 'MISSING_PARAM');
  }

  await assertAttachmentParentAccess(userId, opts, 'view');

  const where: Record<string, string> = {};
  if (opts.issueId) where.issueId = opts.issueId;
  if (opts.pageId) where.pageId = opts.pageId;

  return prisma.attachment.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
}

/**
 * Delete an attachment from storage and database (only the uploader can delete).
 * @param id - The attachment ID
 * @param userId - The user attempting the deletion
 * @throws {AppError} 404 if attachment not found
 * @throws {AppError} 403 if user is not the uploader
 */
export async function deleteAttachment(id: string, userId: string) {
  const attachment = await getDeletableAttachment(id, userId);

  const storage = getStorage();
  await storage.delete(attachment.storageKey);
  await prisma.attachment.delete({ where: { id } });

  if (attachment.issueId) {
    await logActivity('issue', attachment.issueId, 'attachment_removed', userId, {
      attachmentId: id,
      fileName: attachment.originalName,
    });
  }
}

/**
 * Get an attachment this user may delete.
 * @param id - The attachment ID
 * @param userId - The user attempting the deletion
 * @returns The attachment record
 * @throws {AppError} 404 if attachment not found
 * @throws {AppError} 403 if user is not the uploader or can no longer change the parent
 */
export async function getDeletableAttachment(id: string, userId: string) {
  const attachment = await prisma.attachment.findUnique({ where: { id } });
  if (!attachment) throw new AppError(404, ERR.ATTACHMENT_NOT_FOUND, 'NOT_FOUND');

  // Check ownership -- only the uploader can delete.
  // Org-level admin checks require org context and are handled at the route level if needed.
  if (attachment.uploaderId !== userId) {
    throw new AppError(403, 'Only the uploader can delete this attachment', 'FORBIDDEN');
  }
  // The uploader must still be allowed to change the parent (removed from the team, or
  // demoted to VIEWER, and they can't)
  if (attachment.issueId || attachment.pageId) {
    await assertAttachmentParentAccess(userId, attachment, 'edit');
  }
  return attachment;
}

/**
 * Get the file buffer for download.
 * @param id - The attachment ID
 * @param userId
 * @returns Object with attachment metadata and file data buffer
 * @throws {AppError} 404 if attachment not found
 */
export async function downloadAttachment(id: string, userId: string) {
  const attachment = await getAttachmentAuthorized(id, userId);
  const storage = getStorage();
  const data = await storage.get(attachment.storageKey);
  return { attachment, data };
}

/**
 * Write a buffer to a temporary file and return its path.
 * Caller is responsible for cleanup.
 * @param data
 * @param ext
 */
async function writeToTempFile(data: Buffer, ext: string): Promise<string> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'axiom-preview-'));
  const tmpFile = path.join(tmpDir, `file.${ext}`);
  await fs.writeFile(tmpFile, data);
  return tmpFile;
}

/**
 * Clean up a temporary file and its parent directory.
 * @param filePath
 */
async function cleanupTempFile(filePath: string): Promise<void> {
  await fs.unlink(filePath).catch(() => {});
  await fs.rmdir(path.dirname(filePath)).catch(() => {});
}

/**
 * Generate a preview for an attachment.
 * @param id - The attachment ID
 * @param userId
 * @returns Preview result with type, content, and mimeType
 * @throws {AppError} 404 if attachment not found
 * @throws {AppError} 415 if preview not supported for the file type
 */
export async function preview(
  id: string,
  userId: string,
): Promise<{
  type: 'redirect' | 'text' | 'html' | 'pdf';
  content: string | Buffer;
  mimeType: string;
}> {
  const attachment = await getAttachmentAuthorized(id, userId);
  const mime = attachment.mimeType;

  // Images: redirect to download endpoint
  if (mime.startsWith('image/')) {
    return { type: 'redirect', content: '', mimeType: mime };
  }

  const storage = getStorage();
  const data = await storage.get(attachment.storageKey);

  // PDF: return raw buffer
  if (mime === 'application/pdf') {
    return { type: 'pdf', content: data, mimeType: 'application/pdf' };
  }

  // Plain text, JSON, XML: return as text
  if (mime.startsWith('text/') && !PANDOC_FORMAT_MAP[mime]) {
    return { type: 'text', content: data.toString('utf-8'), mimeType: 'text/plain' };
  }
  if (mime === 'application/json' || mime === 'application/xml') {
    return { type: 'text', content: data.toString('utf-8'), mimeType: 'text/plain' };
  }

  // Pandoc-convertible formats: convert to HTML
  const pandocFormat = PANDOC_FORMAT_MAP[mime];
  if (pandocFormat) {
    const ext = path.extname(attachment.originalName).slice(1) || 'bin';
    const tmpFile = await writeToTempFile(data, ext);
    try {
      const { stdout } = await execFileAsync('pandoc', [
        '-f',
        pandocFormat,
        '-t',
        'html',
        '--standalone',
        tmpFile,
      ]);
      return { type: 'html', content: stdout, mimeType: 'text/html' };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Pandoc conversion failed';
      throw new AppError(500, `Preview conversion failed: ${message}`, 'CONVERSION_ERROR');
    } finally {
      await cleanupTempFile(tmpFile);
    }
  }

  throw new AppError(415, 'Preview not supported for this file type', 'UNSUPPORTED_PREVIEW');
}

/**
 * Convert an attachment to GitHub-flavored Markdown using pandoc.
 * @param id - The attachment ID
 * @param userId
 * @returns Object with markdown content and original file name
 * @throws {AppError} 404 if attachment not found
 * @throws {AppError} 415 if the file type cannot be converted to markdown
 */
export async function convertToMarkdown(
  id: string,
  userId: string,
): Promise<{ markdown: string; originalName: string }> {
  const attachment = await getAttachmentAuthorized(id, userId);
  const pandocFormat = PANDOC_FORMAT_MAP[attachment.mimeType];

  if (!pandocFormat) {
    throw new AppError(415, 'Cannot convert this file type to markdown', 'UNSUPPORTED_CONVERSION');
  }

  const storage = getStorage();
  const data = await storage.get(attachment.storageKey);
  const ext = path.extname(attachment.originalName).slice(1) || 'bin';
  const tmpFile = await writeToTempFile(data, ext);

  try {
    const { stdout } = await execFileAsync('pandoc', ['-f', pandocFormat, '-t', 'gfm', tmpFile]);
    return { markdown: stdout, originalName: attachment.originalName };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Pandoc conversion failed';
    throw new AppError(500, `Markdown conversion failed: ${message}`, 'CONVERSION_ERROR');
  } finally {
    await cleanupTempFile(tmpFile);
  }
}
