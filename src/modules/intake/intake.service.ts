import { prisma } from '../../config/database';
import { ERR } from '../../utils/error-messages';
import { findOrThrow } from '../../utils/find-or-throw';
import { createIssue } from '../issues/issues.service';

// ─── List ────────────────────────────────────────────────────

/**
 *
 * @param projectId
 * @param opts
 * @param opts.status
 * @param opts.formId
 * @param opts.limit
 * @param opts.offset
 */
export async function listSubmissions(
  projectId: string,
  opts: {
    status?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SPAM';
    formId?: string;
    limit: number;
    offset: number;
  },
) {
  const where = {
    projectId,
    ...(opts.status ? { status: opts.status } : {}),
    ...(opts.formId ? { formId: opts.formId } : {}),
  };

  const [submissions, total] = await Promise.all([
    prisma.formSubmission.findMany({
      where,
      include: {
        form: { select: { id: true, name: true, slug: true } },
        issue: { select: { id: true, number: true, title: true } },
        reviewedBy: { select: { id: true, displayName: true, avatarUrl: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: opts.limit,
      skip: opts.offset,
    }),
    prisma.formSubmission.count({ where }),
  ]);

  return { submissions, total };
}

// ─── Get ─────────────────────────────────────────────────────

/**
 *
 * @param submissionId
 * @param projectId
 */
export async function getSubmission(submissionId: string, projectId: string) {
  return findOrThrow(
    prisma.formSubmission.findFirst({
      where: { id: submissionId, projectId },
      include: {
        form: {
          include: {
            pages: {
              include: {
                fields: { orderBy: { position: 'asc' } },
              },
              orderBy: { position: 'asc' },
            },
          },
        },
        issue: { select: { id: true, number: true, title: true } },
        reviewedBy: { select: { id: true, displayName: true, avatarUrl: true } },
      },
    }),
    ERR.SUBMISSION_NOT_FOUND,
  );
}

// ─── Approve ─────────────────────────────────────────────────

/**
 *
 * @param submissionId
 * @param projectId
 * @param reviewerId
 * @param issueData
 * @param issueData.title
 * @param issueData.body
 * @param issueData.type
 * @param issueData.priority
 * @param issueData.assigneeId
 * @param issueData.labels
 */
export async function approveSubmission(
  submissionId: string,
  projectId: string,
  reviewerId: string,
  issueData: {
    title: string;
    body?: string;
    type?: 'TASK' | 'BUG' | 'STORY' | 'EPIC';
    priority?: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
    assigneeId?: string;
    labels?: string[];
  },
) {
  const submission = await findOrThrow(
    prisma.formSubmission.findFirst({
      where: { id: submissionId, projectId, status: 'PENDING' },
    }),
    'Submission not found or not pending',
  );

  const issue = await createIssue(projectId, reviewerId, issueData);

  return prisma.formSubmission.update({
    where: { id: submission.id },
    data: {
      status: 'APPROVED',
      issueId: issue.id,
      reviewedById: reviewerId,
      reviewedAt: new Date(),
    },
    include: {
      form: { select: { id: true, name: true, slug: true } },
      issue: { select: { id: true, number: true, title: true } },
      reviewedBy: { select: { id: true, displayName: true, avatarUrl: true } },
    },
  });
}

// ─── Reject ──────────────────────────────────────────────────

/**
 *
 * @param submissionId
 * @param projectId
 * @param reviewerId
 * @param reviewNote
 */
export async function rejectSubmission(
  submissionId: string,
  projectId: string,
  reviewerId: string,
  reviewNote?: string,
) {
  const submission = await findOrThrow(
    prisma.formSubmission.findFirst({
      where: { id: submissionId, projectId, status: 'PENDING' },
    }),
    'Submission not found or not pending',
  );

  return prisma.formSubmission.update({
    where: { id: submission.id },
    data: {
      status: 'REJECTED',
      reviewedById: reviewerId,
      reviewedAt: new Date(),
      reviewNote,
    },
  });
}

// ─── Mark Spam ───────────────────────────────────────────────

/**
 *
 * @param submissionId
 * @param projectId
 * @param reviewerId
 */
export async function markSpam(submissionId: string, projectId: string, reviewerId: string) {
  const submission = await findOrThrow(
    prisma.formSubmission.findFirst({
      where: { id: submissionId, projectId },
    }),
    ERR.SUBMISSION_NOT_FOUND,
  );

  return prisma.formSubmission.update({
    where: { id: submission.id },
    data: {
      status: 'SPAM',
      reviewedById: reviewerId,
      reviewedAt: new Date(),
    },
  });
}
