import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { findOrThrow } from '../../utils/find-or-throw';
import { parseServicePagination } from '../../utils/pagination';
import { USER_BASIC_SELECT } from '../../utils/prisma-selects';

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
  await findOrThrow(prisma.page.findUnique({ where: { id: pageId } }), 'Page not found');

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
    'Comment not found',
  );
  if (comment.userId !== userId) throw new AppError(403, 'You can only edit your own comments');

  return prisma.pageComment.update({
    where: { id: commentId },
    data: { body },
    include: COMMENT_INCLUDE,
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
    include: COMMENT_INCLUDE,
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
    'Comment not found',
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
