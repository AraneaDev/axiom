import crypto from 'crypto';
import path from 'path';

import { createId } from '@paralleldrive/cuid2';
import type { Prisma } from '@prisma/client';

import { prisma } from '../../config/database';
import { env } from '../../config/env';
import { AppError } from '../../middleware/errorHandler';
import { scopeAllows } from '../../middleware/token-scopes';
import { getStorage } from '../../storage/storage';
import { ERR } from '../../utils/error-messages';
import { logger } from '../../utils/logger';
import { logActivity } from '../activity/activity.service';

import {
  assertAttachmentParentAccess,
  assertParentScope,
  assertStagedQuota,
  bareMimeType,
  isAllowedMimeType,
  MAX_ATTACHMENT_BYTES,
  MAX_FILENAME_LENGTH,
  mimeTypeRefusal,
  uploadAttachment,
} from './attachments.service';
import {
  assertFetchWithinLimit,
  fetchRemoteFile,
  type RemoteFetchDeps,
  withFetchSlot,
} from './remote-file';
import { removeTempFile, type TempFile } from './temp-files';

/** How long a signed upload URL works. */
const UPLOAD_URL_TTL_MS = 10 * 60 * 1000;
/** How long a staged attachment waits for a body write to reference it. */
const STAGED_TTL_MS = 24 * 60 * 60 * 1000;

/** A parent as the actions address it. Task 10 adds issue and page keys. */
export type UploadTarget =
  | { projectId: string; issueNumber: number }
  | { spaceId: string; pageSlug: string };

/** A parent by its ids, as stored on the intent. */
type ResolvedParent = { issueId?: string; pageId?: string };

type UsableIntent = Prisma.UploadIntentGetPayload<{
  include: { apiToken: true; user: { select: { deactivatedAt: true } } };
}>;

// Only this purpose uses this key, so a signature can't stand in for a JWT or the other way round
const SIGNING_KEY = crypto
  .createHmac('sha256', env.JWT_SECRET)
  .update('axiom:upload-url:v1')
  .digest();

/**
 * The signature of an upload URL.
 * @param uploadId - The intent's id
 * @param userId - Who it uploads for
 * @param expiresAt - When it stops working
 */
function signUpload(uploadId: string, userId: string, expiresAt: Date): string {
  return crypto
    .createHmac('sha256', SIGNING_KEY)
    .update(`${uploadId}|${userId}|${expiresAt.toISOString()}`)
    .digest('hex');
}

/**
 * Compare a presented signature in constant time. Hashing first gives both sides one length,
 * so a signature of another length takes the same path.
 * @param presented - What the request carried
 * @param expected - The right signature
 */
function signatureMatches(presented: unknown, expected: string): boolean {
  if (typeof presented !== 'string') return false;
  const digest = (value: string) => crypto.createHash('sha256').update(value).digest();
  return crypto.timingSafeEqual(digest(presented), digest(expected));
}

/** One answer for every URL that doesn't work, so that ids can't be probed. */
function uploadUrlRefusal(): AppError {
  return new AppError(403, 'This upload URL is not valid', 'UPLOAD_URL_INVALID');
}

/**
 * Reduce a client's file name to a base name.
 * @param name - The name as given
 * @throws {AppError} 400 when nothing usable is left
 */
function cleanFilename(name: string): string {
  const base = path
    .basename(name.replace(/\\/g, '/'))
    .replace(/\p{Cc}/gu, '')
    .trim();
  if (!base || base === '.' || base === '..') {
    throw new AppError(400, 'The file name is not valid');
  }
  return base;
}

/**
 * Find the issue or page a target names. Run after authorize, so this only tells someone with
 * access that it doesn't exist.
 * @param target - The target
 * @throws {AppError} 404 when it doesn't exist
 */
export async function resolveUploadTarget(target: UploadTarget): Promise<ResolvedParent> {
  if ('projectId' in target) {
    const issue = await prisma.issue.findUnique({
      where: { projectId_number: { projectId: target.projectId, number: target.issueNumber } },
      select: { id: true },
    });
    if (!issue) throw new AppError(404, ERR.ISSUE_NOT_FOUND, 'NOT_FOUND');
    return { issueId: issue.id };
  }
  const page = await prisma.page.findUnique({
    where: { spaceId_slug: { spaceId: target.spaceId, slug: target.pageSlug } },
    select: { id: true },
  });
  if (!page) throw new AppError(404, ERR.PAGE_NOT_FOUND, 'NOT_FOUND');
  return { pageId: page.id };
}

/**
 * Hand out a signed URL for one upload.
 * @param caller - Who asks
 * @param caller.userId
 * @param caller.apiTokenId - Set when a token asks: the URL stops working along with the token
 * @param input - What will be uploaded, and to where
 * @param input.target - The parent; without one the upload is staged
 * @param input.filename
 * @param input.mimeType
 * @param input.size - The most the upload may hold
 * @throws {AppError} 400, 404, 413 or 415 for what can't be uploaded
 */
export async function createUploadUrl(
  caller: { userId: string; apiTokenId?: string },
  input: { target?: UploadTarget; filename: string; mimeType: string; size: number },
) {
  const mimeType = bareMimeType(input.mimeType);
  if (!isAllowedMimeType(mimeType)) throw mimeTypeRefusal(input.mimeType);
  if (input.size > MAX_ATTACHMENT_BYTES) {
    throw new AppError(413, 'File is larger than 25 MB', 'FILE_TOO_LARGE');
  }
  const parent = input.target ? await resolveUploadTarget(input.target) : null;
  if (!parent) await assertStagedQuota(caller.userId);
  const attachmentId = createId();
  const intent = await prisma.uploadIntent.create({
    data: {
      userId: caller.userId,
      apiTokenId: caller.apiTokenId,
      target: parent ?? undefined,
      filename: cleanFilename(input.filename),
      mimeType,
      maxBytes: input.size,
      expiresAt: new Date(Date.now() + UPLOAD_URL_TTL_MS),
      attachmentId,
    },
  });
  const sig = signUpload(intent.id, intent.userId, intent.expiresAt);
  return {
    uploadUrl: `/api/uploads/${intent.id}?sig=${sig}`,
    uploadId: intent.id,
    expiresAt: intent.expiresAt.toISOString(),
    attachmentUrl: `/api/attachments/${attachmentId}`,
  };
}

/**
 * Find the intent behind a signed URL.
 * @param uploadId - The id in the URL
 * @param sig - The signature in the URL, as the query parsed it
 * @returns The intent, not yet used
 * @throws {AppError} The same 403 for anything wrong: a bad signature, an unknown id, a URL that
 * has expired or was used, a deactivated user, a bot that is suspended or gone, or an expired
 * token
 */
export async function findUsableIntent(uploadId: string, sig: unknown): Promise<UsableIntent> {
  // Ids are generated, and a NUL byte would make the query fail instead of find nothing
  if (!/^[a-z0-9]+$/.test(uploadId)) throw uploadUrlRefusal();
  const intent = await prisma.uploadIntent.findUnique({
    where: { id: uploadId },
    include: {
      apiToken: true,
      user: {
        select: { deactivatedAt: true, kind: true, serviceAccount: { select: { status: true } } },
      },
    },
  });
  // An unknown id does the same work as a known one
  const expected = signUpload(uploadId, intent?.userId ?? '', intent?.expiresAt ?? new Date(0));
  const signed = signatureMatches(sig, expected);
  const now = new Date();
  if (
    !intent ||
    !signed ||
    intent.usedAt ||
    intent.expiresAt <= now ||
    intent.user.deactivatedAt ||
    // A bot uploads only while its service account exists and is active, as its token acts
    (intent.user.kind === 'SERVICE' && intent.user.serviceAccount?.status !== 'ACTIVE') ||
    (intent.apiToken?.expiresAt && intent.apiToken.expiresAt <= now)
  ) {
    throw uploadUrlRefusal();
  }
  return intent;
}

/**
 * Read the parent stored on an intent.
 * @param intent - The intent
 * @param intent.target
 */
function storedParent(intent: { target: Prisma.JsonValue }): ResolvedParent {
  return (intent.target ?? {}) as ResolvedParent;
}

/**
 * Check again what was true when the URL was made: the role may be gone, and so may the scopes of
 * the token that asked for it.
 * @param intent - The intent
 * @throws {AppError} 403 or 404 as for any upload to that parent
 */
export async function assertUploadStillAllowed(intent: UsableIntent): Promise<void> {
  const parent = storedParent(intent);
  if (intent.apiToken) {
    if (!scopeAllows(intent.apiToken.scopes, 'files', 'write')) {
      throw new AppError(403, 'This API token does not have the scope for this request', 'SCOPE');
    }
    assertParentScope(intent.apiToken.scopes, parent, true);
  }
  await assertAttachmentParentAccess(intent.userId, parent, 'edit');
  if (!parent.issueId && !parent.pageId) await assertStagedQuota(intent.userId);
}

/**
 * Store the body of a signed upload. The URL is used up here, atomically, so of two requests
 * racing with one URL only one gets through; a request refused earlier leaves the URL usable.
 * @param intent - The intent, from findUsableIntent
 * @param file - The body, in a temp file; gone afterwards, whatever the outcome
 * @returns The attachment, on its parent or staged
 * @throws {AppError} 403 when the URL was used or expired in the meantime
 */
export async function storeSignedUpload(intent: UsableIntent, file: TempFile) {
  const now = new Date();
  const claimed = await prisma.uploadIntent
    .updateMany({
      where: { id: intent.id, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    })
    .catch(async (err: unknown) => {
      await removeTempFile(file.path);
      throw err;
    });
  if (claimed.count !== 1) {
    await removeTempFile(file.path);
    throw uploadUrlRefusal();
  }

  const parent = storedParent(intent);
  return uploadAttachment(
    {
      originalname: intent.filename,
      mimetype: intent.mimeType,
      size: file.size,
      path: file.path,
    },
    intent.userId,
    { ...parent, id: intent.attachmentId, staged: !parent.issueId && !parent.pageId },
  );
}

/**
 * The file name for a fetched file without a given one: the last part of the URL's path.
 * @param url - The URL, which has been fetched
 */
function filenameFromUrl(url: string): string {
  try {
    const last = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '');
    // The end of the name, which holds its extension
    return cleanFilename(last).slice(-MAX_FILENAME_LENGTH);
  } catch {
    return 'download';
  }
}

/**
 * Fetch a file from a URL into an attachment, on the target or staged.
 * @param userId - Who it uploads for
 * @param input - Where from and where to
 * @param input.url
 * @param input.target - The parent; without one the attachment is staged
 * @param input.filename - The name to store it under, else taken from the URL
 * @param deps - Replaceable dependencies (tests)
 * @returns The attachment
 */
export async function attachFromUrl(
  userId: string,
  input: { url: string; target?: UploadTarget; filename?: string },
  deps: Partial<RemoteFetchDeps> = {},
) {
  const parent = input.target ? await resolveUploadTarget(input.target) : null;
  if (!parent) await assertStagedQuota(userId);
  const filename = input.filename ? cleanFilename(input.filename) : undefined;
  return withFetchSlot(userId, async () => {
    // In here: a call refused for its slot does not count against the limit
    await assertFetchWithinLimit(userId);
    const fetched = await fetchRemoteFile(input.url, deps);
    return uploadAttachment(
      {
        originalname: filename ?? filenameFromUrl(input.url),
        mimetype: fetched.mimeType,
        size: fetched.size,
        path: fetched.path,
      },
      userId,
      { ...(parent ?? {}), staged: !parent },
    );
  });
}

const ATTACHMENT_REFERENCE = /\/api\/attachments\/([a-z0-9]+)/g;

/**
 * Attach what a written body references, of what this user staged. Only rows the same user staged
 * and that are still unbound move, and each only once; from then on the file's access follows the
 * parent. Starts from the user's staged rows rather than the body, so that a long body can't make
 * this query large.
 * @param markdown - The written body
 * @param parent - The issue or page it was written to
 * @param parent.issueId
 * @param parent.pageId
 * @param userId - Who wrote it
 */
export async function bindStagedAttachments(
  markdown: string,
  parent: { issueId?: string; pageId?: string },
  userId: string,
): Promise<void> {
  if ((!parent.issueId && !parent.pageId) || !markdown.includes('/api/attachments/')) return;
  const unbound = {
    uploaderId: userId,
    stagedAt: { not: null },
    issueId: null,
    pageId: null,
  };
  const staged = await prisma.attachment.findMany({
    where: unbound,
    select: { id: true, originalName: true },
  });
  if (staged.length === 0) return;
  const referenced = new Set(Array.from(markdown.matchAll(ATTACHMENT_REFERENCE), (m) => m[1]));
  for (const attachment of staged) {
    if (!referenced.has(attachment.id)) continue;
    const bound = await prisma.attachment.updateMany({
      where: { id: attachment.id, ...unbound },
      data: { issueId: parent.issueId, pageId: parent.pageId, stagedAt: null },
    });
    if (bound.count === 1 && parent.issueId) {
      await logActivity('issue', parent.issueId, 'attachment_added', userId, {
        attachmentId: attachment.id,
        fileName: attachment.originalName,
      });
    }
  }
}

/**
 * Remove upload URLs past their expiry and staged attachments nobody referenced within a day.
 * A row goes before its file, and only if it is still staged: a body write may just have bound it.
 */
export async function cleanupExpiredUploads(): Promise<void> {
  const now = Date.now();
  await prisma.uploadIntent.deleteMany({ where: { expiresAt: { lt: new Date(now) } } });

  const stagedBefore = new Date(now - STAGED_TTL_MS);
  const abandonedRows = { stagedAt: { lt: stagedBefore }, issueId: null, pageId: null };
  const abandoned = await prisma.attachment.findMany({
    where: abandonedRows,
    select: { id: true, storageKey: true },
  });
  const storage = getStorage();
  for (const attachment of abandoned) {
    // One row that fails doesn't stop the round
    try {
      const removed = await prisma.attachment.deleteMany({
        where: { id: attachment.id, ...abandonedRows },
      });
      if (removed.count === 1) await storage.delete(attachment.storageKey);
    } catch (err) {
      logger.error(
        'Could not remove a staged attachment',
        { attachmentId: attachment.id, storageKey: attachment.storageKey },
        err as Error,
      );
    }
  }
}
