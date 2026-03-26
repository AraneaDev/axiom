import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { findOrThrow } from '../../utils/find-or-throw';
import { USER_BASIC_SELECT } from '../../utils/prisma-selects';

/**
 * Add a comment to a wiki page, optionally anchored to specific text.
 * @param pageId - The page to comment on
 * @param userId - The user authoring the comment
 * @param body - The comment body text
 * @param anchorText - Optional text selection the comment is anchored to
 * @returns The created comment with user relation
 * @throws {AppError} 404 if page not found
 */
export async function addPageComment(
  pageId: string,
  userId: string,
  body: string,
  anchorText?: string,
) {
  await findOrThrow(prisma.page.findUnique({ where: { id: pageId } }), 'Page not found');

  return prisma.pageComment.create({
    data: { pageId, userId, body, anchorText },
    include: { user: { select: USER_BASIC_SELECT } },
  });
}

/**
 * List all comments on a wiki page, ordered chronologically.
 * @param pageId - The page to list comments for
 * @returns List of comment records with user relations
 */
export async function listPageComments(pageId: string) {
  return prisma.pageComment.findMany({
    where: { pageId },
    include: { user: { select: USER_BASIC_SELECT } },
    orderBy: { createdAt: 'asc' },
  });
}

/**
 * Update a wiki page comment (only the author may edit).
 * @param commentId - The comment to update
 * @param userId - The user attempting the update
 * @param body - The new comment body text
 * @returns The updated comment with user relation
 * @throws {AppError} 404 if comment not found
 * @throws {AppError} 403 if user is not the comment author
 */
export async function updatePageComment(commentId: string, userId: string, body: string) {
  const comment = await findOrThrow(
    prisma.pageComment.findUnique({ where: { id: commentId } }),
    'Comment not found',
  );
  if (comment.userId !== userId) throw new AppError(403, 'You can only edit your own comments');

  return prisma.pageComment.update({
    where: { id: commentId },
    data: { body },
    include: { user: { select: USER_BASIC_SELECT } },
  });
}

/**
 * Toggle the resolved status of a wiki page comment.
 * @param commentId - The comment to resolve/unresolve
 * @returns The updated comment with user relation
 * @throws {AppError} 404 if comment not found
 */
export async function resolveComment(commentId: string) {
  const comment = await findOrThrow(
    prisma.pageComment.findUnique({ where: { id: commentId } }),
    'Comment not found',
  );

  return prisma.pageComment.update({
    where: { id: commentId },
    data: { resolved: !comment.resolved },
    include: { user: { select: USER_BASIC_SELECT } },
  });
}

/**
 * Delete a wiki page comment.
 * @param commentId - The comment to delete
 * @throws {AppError} 404 if comment not found
 */
export async function deletePageComment(commentId: string) {
  await findOrThrow(
    prisma.pageComment.findUnique({ where: { id: commentId } }),
    'Comment not found',
  );
  await prisma.pageComment.delete({ where: { id: commentId } });
}
