import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { assertPageAccess } from '../../middleware/rbac';
import { assertAuthor } from '../../utils/assert-author';
import { ERR } from '../../utils/error-messages';
import { findOrThrow } from '../../utils/find-or-throw';
import { parseServicePagination } from '../../utils/pagination';
import { USER_BASIC_SELECT } from '../../utils/prisma-selects';

import { canAccessSpace } from './space-permissions.service';

const VALID_REACTION_TYPES = ['thumbsup', 'heart', 'eyes', 'rocket', 'thinking', 'check'] as const;

const COMMENT_INCLUDE = {
  user: { select: USER_BASIC_SELECT },
  reactions: {
    select: {
      id: true,
      reactionType: true,
      userId: true,
      user: { select: USER_BASIC_SELECT },
    },
  },
} as const;

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
  await findOrThrow(prisma.page.findUnique({ where: { id: pageId } }), ERR.PAGE_NOT_FOUND);

  return prisma.pageComment.create({
    data: { pageId, userId, body, anchorText },
    include: COMMENT_INCLUDE,
  });
}

/**
 * List comments on a wiki page, ordered chronologically.
 * @param pageId - The page to list comments for
 * @param opts - Pagination options (limit, offset)
 * @param opts.limit
 * @param opts.offset
 * @returns List of comment records with user relations
 */
export async function listPageComments(pageId: string, opts?: { limit?: number; offset?: number }) {
  const { take, skip } = parseServicePagination(opts, 50);
  return prisma.pageComment.findMany({
    where: { pageId },
    include: COMMENT_INCLUDE,
    orderBy: { createdAt: 'asc' },
    take,
    skip,
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
    ERR.COMMENT_NOT_FOUND,
  );
  assertAuthor(comment, userId, 'edit');

  return prisma.pageComment.update({
    where: { id: commentId },
    data: { body },
    include: COMMENT_INCLUDE,
  });
}

/**
 * Toggle the resolved status of a wiki page comment. The comment's author may, and so may
 * anyone who can edit the page; a read-only viewer can't resolve other people's comments.
 * @param commentId - The comment to resolve/unresolve
 * @param userId - The user toggling it
 * @returns The updated comment with user relation
 * @throws {AppError} 404 if comment not found, 403 if not allowed
 */
export async function resolveComment(commentId: string, userId: string) {
  const comment = await findOrThrow(
    prisma.pageComment.findUnique({ where: { id: commentId } }),
    ERR.COMMENT_NOT_FOUND,
  );
  if (comment.userId !== userId) {
    try {
      await assertPageAccess(userId, comment.pageId, 'edit');
    } catch {
      throw new AppError(403, 'Only the author or a page editor can resolve this comment');
    }
  }

  return prisma.pageComment.update({
    where: { id: commentId },
    data: { resolved: !comment.resolved },
    include: COMMENT_INCLUDE,
  });
}

/**
 * Delete a wiki page comment: its author, or an ADMIN of the page's space.
 * @param commentId - The comment to delete
 * @param userId - The user deleting it
 * @throws {AppError} 404 if comment not found, 403 if not allowed
 */
export async function deletePageComment(commentId: string, userId: string) {
  const comment = await findOrThrow(
    prisma.pageComment.findUnique({
      where: { id: commentId },
      select: { userId: true, page: { select: { spaceId: true } } },
    }),
    ERR.COMMENT_NOT_FOUND,
  );
  if (comment.userId !== userId && !(await canAccessSpace(comment.page.spaceId, userId, 'ADMIN'))) {
    throw new AppError(403, 'Only the author or a space admin can delete this comment');
  }
  await prisma.pageComment.delete({ where: { id: commentId } });
}

/**
 * Toggle a reaction on a comment. If the user already reacted with this type,
 * it is removed; otherwise it is added.
 * @param commentId - The comment to react to
 * @param userId - The user toggling the reaction
 * @param reactionType - One of the valid reaction types
 * @returns Whether the reaction was added (true) or removed (false)
 * @throws {AppError} 404 if comment not found
 * @throws {AppError} 400 if reactionType is invalid
 */
export async function toggleReaction(
  commentId: string,
  userId: string,
  reactionType: string,
): Promise<{ added: boolean }> {
  if (!VALID_REACTION_TYPES.includes(reactionType as (typeof VALID_REACTION_TYPES)[number])) {
    throw new AppError(400, `Invalid reaction type: ${reactionType}`);
  }

  await findOrThrow(
    prisma.pageComment.findUnique({ where: { id: commentId } }),
    ERR.COMMENT_NOT_FOUND,
  );

  const existing = await prisma.commentReaction.findUnique({
    where: { commentId_userId_reactionType: { commentId, userId, reactionType } },
  });

  if (existing) {
    await prisma.commentReaction.delete({ where: { id: existing.id } });
    return { added: false };
  }

  await prisma.commentReaction.create({
    data: { commentId, userId, reactionType },
  });
  return { added: true };
}
