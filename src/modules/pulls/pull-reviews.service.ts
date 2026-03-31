import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { findOrThrow } from '../../utils/find-or-throw';
import { logger } from '../../utils/logger';
import { parseServicePagination } from '../../utils/pagination';
import { TEAM_ORG_SELECT } from '../../utils/prisma-selects';
import { logActivity } from '../activity/activity.service';
import { createNotification } from '../notifications/notifications.service';

/**
 * Submit a review on an open pull request and notify the PR author.
 * @param repoId - The repository the PR belongs to
 * @param prNumber - The PR number within the repository
 * @param reviewerId - The user submitting the review
 * @param data - Review data including status (APPROVED, CHANGES_REQUESTED, COMMENTED) and optional body
 * @param data.status
 * @param data.body
 * @returns The created review record
 * @throws {AppError} 404 if PR not found
 * @throws {AppError} 400 if PR is not open
 */
export async function submitReview(
  repoId: string,
  prNumber: number,
  reviewerId: string,
  data: {
    status: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED';
    body?: string;
  },
) {
  const pr = await findOrThrow(
    prisma.pullRequest.findUnique({
      where: { repoId_number: { repoId, number: prNumber } },
      include: {
        repo: {
          select: { slug: true, team: { select: TEAM_ORG_SELECT } },
        },
      },
    }),
    'Pull request not found',
  );
  if (pr.status !== 'OPEN') throw new AppError(400, 'Can only review open PRs');

  const review = await prisma.pRReview.create({
    data: {
      prId: pr.id,
      reviewerId,
      status: data.status,
      body: data.body ?? '',
    },
  });

  // Notify PR author about the review (if not self-review)
  if (pr.authorId !== reviewerId) {
    const statusLabel =
      data.status === 'APPROVED'
        ? 'approved'
        : data.status === 'CHANGES_REQUESTED'
          ? 'requested changes on'
          : 'commented on';
    createNotification(
      pr.authorId,
      'pr:reviewed',
      `Review ${statusLabel} PR #${prNumber}: ${pr.title}`,
      data.body
        ? data.body.length > 120
          ? data.body.slice(0, 120) + '...'
          : data.body
        : undefined,
      `/${pr.repo.team.org.slug}/${pr.repo.team.slug}/repos/${pr.repo.slug}/pulls/${prNumber}`,
    ).catch((err) => {
      logger.error('Failed to send PR review notification', { prId: pr.id }, err as Error);
    });
  }

  await logActivity('pull_request', pr.id, 'review_submitted', reviewerId, {
    status: data.status,
    prNumber,
  });
  return review;
}

/**
 * List reviews for a pull request, ordered by most recent first.
 * @param repoId - The repository the PR belongs to
 * @param prNumber - The PR number within the repository
 * @param opts - Pagination options (limit, offset)
 * @param opts.limit
 * @param opts.offset
 * @returns List of review records
 * @throws {AppError} 404 if PR not found
 */
export async function listReviews(
  repoId: string,
  prNumber: number,
  opts?: { limit?: number; offset?: number },
) {
  const pr = await findOrThrow(
    prisma.pullRequest.findUnique({
      where: { repoId_number: { repoId, number: prNumber } },
    }),
    'Pull request not found',
  );

  const { take, skip } = parseServicePagination(opts, 50);
  return prisma.pRReview.findMany({
    where: { prId: pr.id },
    orderBy: { createdAt: 'desc' },
    take,
    skip,
  });
}
