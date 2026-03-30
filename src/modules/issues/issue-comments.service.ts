import { prisma } from '../../config/database';
import { broadcastToRoom } from '../../realtime/broadcast';
import { assertAuthor } from '../../utils/assert-author';
import { findOrThrow } from '../../utils/find-or-throw';
import { logger } from '../../utils/logger';
import { notifyMentions } from '../../utils/mention-notifier';
import { USER_BASIC_SELECT } from '../../utils/prisma-selects';
import { logActivity } from '../activity/activity.service';
import { createNotification } from '../notifications/notifications.service';

/**
 * Add a comment to an issue, notifying the assignee and any mentioned users.
 * @param issueId - The issue to comment on
 * @param authorId - The user authoring the comment
 * @param body - The comment body text
 * @returns The created comment with author relation
 */
export async function addComment(issueId: string, authorId: string, body: string) {
  const comment = await prisma.comment.create({
    data: { issueId, authorId, body },
    include: { author: { select: USER_BASIC_SELECT } },
  });

  await logActivity('issue', issueId, 'commented', authorId, { commentId: comment.id });

  // Notify issue assignee about the new comment (if not the commenter)
  const issue = await prisma.issue.findUnique({
    where: { id: issueId },
    select: {
      assigneeId: true,
      title: true,
      number: true,
      project: {
        select: { slug: true, team: { select: { slug: true, org: { select: { slug: true } } } } },
      },
    },
  });
  const issueUrl = issue?.project
    ? `/${issue.project.team.org.slug}/${issue.project.team.slug}/${issue.project.slug}/issues/${issue.number}`
    : undefined;
  if (issue?.assigneeId && issue.assigneeId !== authorId) {
    createNotification(
      issue.assigneeId,
      'issue:commented',
      `New comment on ${issue.title}`,
      body.length > 120 ? body.slice(0, 120) + '...' : body,
      issueUrl,
    ).catch((err) => {
      logger.error('Failed to send comment notification', { issueId }, err as Error);
    });
  }

  // Notify @mentioned users in the comment
  notifyMentions(body, authorId, issueUrl).catch((err) => {
    logger.error('Failed to send mention notifications', { issueId }, err as Error);
  });

  // Broadcast to project room -- look up projectId from the issue
  const issueForBroadcast = await prisma.issue.findUnique({
    where: { id: issueId },
    select: { projectId: true },
  });
  if (issueForBroadcast) {
    broadcastToRoom(`project:${issueForBroadcast.projectId}`, {
      type: 'comment:added',
      projectId: issueForBroadcast.projectId,
      issueId,
    });
  }

  return comment;
}

/**
 * Update an existing issue comment (only the author may edit).
 * @param commentId - The comment to update
 * @param userId - The user attempting the update
 * @param body - The new comment body text
 * @returns The updated comment with author relation
 * @throws {AppError} 404 if comment not found
 * @throws {AppError} 403 if user is not the comment author
 */
export async function updateComment(commentId: string, userId: string, body: string) {
  const comment = await findOrThrow(
    prisma.comment.findUnique({ where: { id: commentId } }),
    'Comment not found',
  );
  assertAuthor(comment, userId, 'edit');

  return prisma.comment.update({
    where: { id: commentId },
    data: { body },
    include: { author: { select: USER_BASIC_SELECT } },
  });
}

/**
 * Delete an issue comment (only the author may delete).
 * @param commentId - The comment to delete
 * @param userId - The user attempting the deletion
 * @throws {AppError} 404 if comment not found
 * @throws {AppError} 403 if user is not the comment author
 */
export async function deleteComment(commentId: string, userId: string) {
  const comment = await findOrThrow(
    prisma.comment.findUnique({ where: { id: commentId } }),
    'Comment not found',
  );
  assertAuthor(comment, userId, 'delete');

  await prisma.comment.delete({ where: { id: commentId } });
}
