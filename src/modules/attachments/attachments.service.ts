import path from 'path';

import { createId } from '@paralleldrive/cuid2';

import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { getStorage } from '../../storage/storage';

/**
 * Build a storage key for an attachment.
 * Format: attachments/{year}/{month}/{cuid}.{ext}
 * @param originalName
 */
function buildStorageKey(originalName: string): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const ext = path.extname(originalName).slice(1) || 'bin';
  const id = createId();
  return `attachments/${year}/${month}/${id}.${ext}`;
}

/**
 * Upload a file and create the database record.
 * @param file
 * @param uploaderId
 * @param opts
 * @param opts.issueId
 * @param opts.pageId
 * @param opts.commentId
 */
export async function uploadAttachment(
  file: Express.Multer.File,
  uploaderId: string,
  opts: { issueId?: string; pageId?: string; commentId?: string },
) {
  const storageKey = buildStorageKey(file.originalname);
  const storage = getStorage();

  await storage.put(storageKey, file.buffer, file.mimetype);

  const attachment = await prisma.attachment.create({
    data: {
      filename: path.basename(storageKey),
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      storageKey,
      uploaderId,
      issueId: opts.issueId ?? null,
      pageId: opts.pageId ?? null,
      commentId: opts.commentId ?? null,
    },
  });

  return attachment;
}

/**
 * Get attachment metadata by ID.
 * @param id
 */
export async function getAttachment(id: string) {
  const attachment = await prisma.attachment.findUnique({ where: { id } });
  if (!attachment) throw new AppError(404, 'Attachment not found', 'NOT_FOUND');
  return attachment;
}

/**
 * List attachments for a given resource.
 * @param opts
 * @param opts.issueId
 * @param opts.pageId
 */
export async function listAttachments(opts: { issueId?: string; pageId?: string }) {
  const where: Record<string, string> = {};
  if (opts.issueId) where.issueId = opts.issueId;
  if (opts.pageId) where.pageId = opts.pageId;

  return prisma.attachment.findMany({
    where,
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Delete an attachment from storage and DB.
 * Only the uploader or an admin can delete.
 * @param id
 * @param userId
 */
export async function deleteAttachment(id: string, userId: string) {
  const attachment = await prisma.attachment.findUnique({ where: { id } });
  if (!attachment) throw new AppError(404, 'Attachment not found', 'NOT_FOUND');

  // Check ownership -- only the uploader can delete.
  // Org-level admin checks require org context and are handled at the route level if needed.
  if (attachment.uploaderId !== userId) {
    throw new AppError(403, 'Only the uploader can delete this attachment', 'FORBIDDEN');
  }

  const storage = getStorage();
  await storage.delete(attachment.storageKey);
  await prisma.attachment.delete({ where: { id } });
}

/**
 * Get the file buffer for download.
 * @param id
 */
export async function downloadAttachment(id: string) {
  const attachment = await getAttachment(id);
  const storage = getStorage();
  const data = await storage.get(attachment.storageKey);
  return { attachment, data };
}
