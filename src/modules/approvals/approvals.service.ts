import type { z } from 'zod';

import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { checkProjectAction } from '../../middleware/requireProjectAccess';
import { broadcastToRoom } from '../../realtime/broadcast';
import { ERR } from '../../utils/error-messages';
import { findOrThrow } from '../../utils/find-or-throw';
import { logger } from '../../utils/logger';
import { USER_WITH_AVATAR_SELECT } from '../../utils/prisma-selects';
import { logActivity } from '../activity/activity.service';
import { entryColumnIds } from '../issues/issue-references';
import { createNotification } from '../notifications/notifications.service';
import { isServiceAccount } from '../service-accounts/person';

import type { updateGateSchema, createGateSchema, castVoteSchema } from './approvals.validation';

// ─── Gate CRUD ──────────────────────────────────────────────────────────────

/**
 * The project an approval request belongs to, through its issue.
 * @param requestId - The approval request
 */
export async function requestProjectId(requestId: string): Promise<string | undefined> {
  const request = await prisma.approvalRequest.findUnique({
    where: { id: requestId },
    select: { issue: { select: { projectId: true } } },
  });
  return request?.issue.projectId;
}

/**
 * List all approval gates for a project.
 * @param projectId
 */
export async function listGates(projectId: string) {
  return prisma.approvalGate.findMany({
    where: { projectId },
    select: {
      id: true,
      projectId: true,
      fromColumnId: true,
      toColumnId: true,
      minApprovals: true,
      allowSelfApproval: true,
      enabled: true,
      createdAt: true,
      updatedAt: true,
      fromColumn: { select: { id: true, name: true } },
      toColumn: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
}

/**
 * Create an approval gate between two columns in a project.
 * @param projectId
 * @param data
 * @throws {AppError} 400 if from === to, columns not in project, or duplicate gate
 */
export async function createGate(projectId: string, data: z.output<typeof createGateSchema>) {
  if (data.fromColumnId === data.toColumnId) {
    throw new AppError(400, 'fromColumnId and toColumnId must be different');
  }

  // Verify columns belong to this project
  const columns = await prisma.boardColumn.findMany({
    where: { id: { in: [data.fromColumnId, data.toColumnId] }, projectId },
    select: { id: true },
  });

  if (columns.length !== 2) {
    throw new AppError(400, 'One or both columns do not belong to this project');
  }

  // New issues land in the entry column: a gate there would let them in without approval
  if ((await entryColumnIds(projectId)).includes(data.toColumnId)) {
    throw new AppError(400, 'An approval gate cannot guard the column new issues land in');
  }

  // Check for duplicate
  const existing = await prisma.approvalGate.findUnique({
    where: {
      projectId_fromColumnId_toColumnId: {
        projectId,
        fromColumnId: data.fromColumnId,
        toColumnId: data.toColumnId,
      },
    },
  });

  if (existing) {
    throw new AppError(409, 'An approval gate already exists for this column transition');
  }

  return prisma.approvalGate.create({
    data: {
      projectId,
      fromColumnId: data.fromColumnId,
      toColumnId: data.toColumnId,
      minApprovals: data.minApprovals,
      allowSelfApproval: data.allowSelfApproval,
    },
    select: {
      id: true,
      projectId: true,
      fromColumnId: true,
      toColumnId: true,
      minApprovals: true,
      allowSelfApproval: true,
      enabled: true,
      createdAt: true,
      updatedAt: true,
      fromColumn: { select: { id: true, name: true } },
      toColumn: { select: { id: true, name: true } },
    },
  });
}

/**
 * Update an approval gate.
 * @param projectId
 * @param gateId
 * @param data
 * @throws {AppError} 404 if gate not found in project
 */
export async function updateGate(
  projectId: string,
  gateId: string,
  data: z.output<typeof updateGateSchema>,
) {
  await findOrThrow(
    prisma.approvalGate.findUnique({ where: { id: gateId, projectId } }),
    'Approval gate not found',
  );

  return prisma.approvalGate.update({
    where: { id: gateId },
    data,
    select: {
      id: true,
      projectId: true,
      fromColumnId: true,
      toColumnId: true,
      minApprovals: true,
      allowSelfApproval: true,
      enabled: true,
      createdAt: true,
      updatedAt: true,
      fromColumn: { select: { id: true, name: true } },
      toColumn: { select: { id: true, name: true } },
    },
  });
}

/**
 * Delete an approval gate, cancelling any pending requests first.
 * @param projectId
 * @param gateId
 * @throws {AppError} 404 if gate not found in project
 */
export async function deleteGate(projectId: string, gateId: string) {
  await findOrThrow(
    prisma.approvalGate.findUnique({ where: { id: gateId, projectId } }),
    'Approval gate not found',
  );

  // Cancel pending requests for this gate
  await prisma.approvalRequest.updateMany({
    where: { approvalGateId: gateId, status: 'PENDING' },
    data: { status: 'CANCELLED', resolvedAt: new Date() },
  });

  await prisma.approvalGate.delete({ where: { id: gateId } });
}

// ─── Approval Requests ───────────────────────────────────────────────────────

const REQUEST_INCLUDE = {
  requestedBy: { select: USER_WITH_AVATAR_SELECT },
  targetColumn: { select: { id: true, name: true } },
  approvalGate: {
    select: {
      id: true,
      minApprovals: true,
      allowSelfApproval: true,
      fromColumn: { select: { id: true, name: true } },
      toColumn: { select: { id: true, name: true } },
    },
  },
  votes: {
    select: {
      id: true,
      decision: true,
      comment: true,
      createdAt: true,
      user: { select: USER_WITH_AVATAR_SELECT },
    },
  },
} as const;

/**
 * Which of some users count as the requester for self-approval: the requester, and when the
 * requester is a bot, each of its owners (decision 12). Every owner row counts, eligible or not:
 * a refusal is never the wrong side to err on.
 * @param requesterId - Who raised the request
 * @param userIds - The users to test
 */
async function selvesOf(requesterId: string, userIds: string[]): Promise<string[]> {
  const selves = userIds.filter((id) => id === requesterId);
  const others = userIds.filter((id) => id !== requesterId);
  if (others.length === 0) return selves;
  const owners = await prisma.serviceAccountOwner.findMany({
    where: { serviceAccountId: requesterId, ownerId: { in: others } },
    select: { ownerId: true },
  });
  return [...selves, ...owners.map((o) => o.ownerId)];
}

/**
 * Create an approval request for an issue to move to a target column.
 * @param issueId
 * @param targetColumnId
 * @param requestedById
 * @param approverIds
 * @throws {AppError} 404 if issue not found
 * @throws {AppError} 400 if no gate exists, already pending, or validation fails
 */
export async function createApprovalRequestWithTarget(
  issueId: string,
  targetColumnId: string,
  requestedById: string,
  approverIds: string[],
) {
  const issue = await findOrThrow(
    prisma.issue.findUnique({
      where: { id: issueId },
      include: {
        column: { select: { id: true, name: true } },
        project: {
          include: { team: { include: { org: true } } },
        },
      },
    }),
    ERR.ISSUE_NOT_FOUND,
  );

  // The gate guarding the target column: the one for this exact transition if there is
  // one, otherwise any enabled gate into that column (gates guard the destination)
  const gate =
    (issue.columnId
      ? await prisma.approvalGate.findFirst({
          where: {
            projectId: issue.projectId,
            fromColumnId: issue.columnId,
            toColumnId: targetColumnId,
            enabled: true,
          },
        })
      : null) ??
    (await prisma.approvalGate.findFirst({
      where: { projectId: issue.projectId, toColumnId: targetColumnId, enabled: true },
      orderBy: { createdAt: 'asc' },
    }));

  if (!gate) {
    throw new AppError(400, 'No approval gate found for this column transition');
  }

  // Check no existing PENDING request
  const existingRequest = await prisma.approvalRequest.findFirst({
    where: { issueId, approvalGateId: gate.id, status: 'PENDING' },
  });

  if (existingRequest) {
    throw new AppError(409, 'A pending approval request already exists for this issue');
  }

  // A bot is never named to decide: said as such, before any rule that counts approvers
  for (const approverId of new Set(approverIds)) {
    if (await isServiceAccount(approverId)) {
      throw new AppError(
        400,
        'A service account cannot be an approver',
        'SERVICE_ACCOUNT_NOT_APPROVER',
      );
    }
  }

  // Validate self-approval rule. A bot's owners count as the bot (decision 12)
  if (!gate.allowSelfApproval && (await selvesOf(requestedById, approverIds)).length > 0) {
    throw new AppError(
      400,
      'Self-approval is not allowed for this gate',
      'SELF_APPROVAL_NOT_ALLOWED',
    );
  }

  // Validate min approvers count
  if (approverIds.length < gate.minApprovals) {
    throw new AppError(400, `At least ${gate.minApprovals} approver(s) required for this gate`);
  }

  // Verify approvers are team members, and people: a bot is never named to decide
  const teamMembers = await prisma.teamMembership.findMany({
    where: {
      teamId: issue.project.teamId,
      userId: { in: approverIds },
      user: { kind: 'PERSON' },
    },
    select: { userId: true },
  });

  if (teamMembers.length !== approverIds.length) {
    throw new AppError(400, 'One or more approvers are not members of this team');
  }

  const request = await prisma.approvalRequest.create({
    data: {
      issueId,
      approvalGateId: gate.id,
      targetColumnId,
      requestedById,
      approverIds,
    },
    include: REQUEST_INCLUDE,
  });

  // Notify each approver
  const issueKey = `${issue.project.prefix}-${issue.number}`;
  for (const approverId of approverIds) {
    try {
      await createNotification(
        approverId,
        'approval:requested',
        `Approval requested for ${issueKey}`,
        `Your approval is needed to move "${issue.title}" to ${request.targetColumn.name}`,
      );
    } catch (err) {
      logger.warn(
        'Failed to send approval request notification',
        { approverId },
        err instanceof Error ? err : undefined,
      );
    }
  }

  // Broadcast to project room
  broadcastToRoom(`project:${issue.projectId}`, {
    type: 'approval:request:created',
    projectId: issue.projectId,
    requestId: request.id,
    issueId,
  });

  return request;
}

/**
 * Get all approval requests for an issue.
 * @param issueId
 */
export async function getRequestsForIssue(issueId: string) {
  return prisma.approvalRequest.findMany({
    where: { issueId },
    include: REQUEST_INCLUDE,
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Get all pending approval requests for a user across their projects.
 * Returns requests where the user hasn't voted yet.
 * @param userId
 */
export async function getPendingApprovalsForUser(userId: string) {
  // Find team memberships
  const memberships = await prisma.teamMembership.findMany({
    where: { userId },
    select: { teamId: true },
  });

  const teamIds = memberships.map((m: { teamId: string }) => m.teamId);

  // Find pending requests in those teams where user hasn't voted
  const requests = await prisma.approvalRequest.findMany({
    where: {
      status: 'PENDING',
      issue: {
        project: { teamId: { in: teamIds } },
      },
      votes: {
        none: { userId },
      },
    },
    include: {
      ...REQUEST_INCLUDE,
      issue: {
        select: {
          id: true,
          title: true,
          number: true,
          project: {
            select: {
              id: true,
              name: true,
              prefix: true,
              slug: true,
              team: { select: { slug: true, org: { select: { slug: true } } } },
            },
          },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  return requests;
}

/**
 * List all pending approval requests for a project (for board badges).
 * @param projectId
 */
export async function listPendingForProject(projectId: string) {
  return prisma.approvalRequest.findMany({
    where: {
      status: 'PENDING',
      issue: { projectId },
    },
    include: {
      ...REQUEST_INCLUDE,
      issue: { select: { id: true, title: true, number: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
}

// ─── Voting ──────────────────────────────────────────────────────────────────

/**
 * Cast a vote on an approval request.
 * On rejection: request is immediately rejected.
 * On approval: if votes >= minApprovals, issue is moved and request resolved.
 * @param requestId
 * @param userId
 * @param data
 * @throws {AppError} 404 if request not found
 * @throws {AppError} 400 if request not pending, already voted, or self-approval violation
 */
export async function castVote(
  requestId: string,
  userId: string,
  data: z.output<typeof castVoteSchema>,
) {
  const request = await findOrThrow(
    prisma.approvalRequest.findUnique({
      where: { id: requestId },
      include: {
        approvalGate: true,
        votes: { select: { id: true, userId: true, decision: true } },
        issue: {
          include: {
            project: { include: { team: { include: { org: true } } } },
          },
        },
      },
    }),
    'Approval request not found',
  );

  if (request.status !== 'PENDING') {
    throw new AppError(400, 'This approval request is no longer pending');
  }

  // Only the approvers named on the request may vote. Requests made before approvers were
  // stored have none: any member who reached this route (project access) may vote on those.
  if (request.approverIds.length > 0 && !request.approverIds.includes(userId)) {
    throw new AppError(403, 'You are not an approver on this request');
  }
  // A request from before approvers were stored names nobody: only someone who could move
  // the issue themselves (issue:edit by role) may approve it
  if (
    request.approverIds.length === 0 &&
    (await checkProjectAction(userId, request.issue.projectId, 'issue:edit')) !== 'ok'
  ) {
    throw new AppError(403, 'Insufficient permissions: issue:edit');
  }
  if (
    !request.approvalGate.allowSelfApproval &&
    (await selvesOf(request.requestedById, [userId])).length > 0
  ) {
    throw new AppError(
      403,
      'This gate does not allow approving your own request, or one your service account raised',
      'SELF_APPROVAL_NOT_ALLOWED',
    );
  }

  // Check no duplicate vote
  const alreadyVoted = request.votes.some((v) => v.userId === userId);
  if (alreadyVoted) {
    throw new AppError(409, 'You have already voted on this request');
  }

  // Create the vote
  const vote = await prisma.approvalVote.create({
    data: {
      approvalRequestId: requestId,
      userId,
      decision: data.decision,
      comment: data.comment,
    },
    select: {
      id: true,
      decision: true,
      comment: true,
      createdAt: true,
      user: { select: USER_WITH_AVATAR_SELECT },
    },
  });

  const issue = request.issue;
  const issueKey = `${issue.project.prefix}-${issue.number}`;

  if (data.decision === 'REJECTED') {
    // Reject the request immediately
    await prisma.approvalRequest.update({
      where: { id: requestId },
      data: { status: 'REJECTED', resolvedAt: new Date() },
    });

    // Notify requester
    try {
      await createNotification(
        request.requestedById,
        'approval:rejected',
        `Approval rejected for ${issueKey}`,
        `Your request to move "${issue.title}" was rejected`,
      );
    } catch (err) {
      logger.warn(
        'Failed to send approval rejection notification',
        {},
        err instanceof Error ? err : undefined,
      );
    }

    broadcastToRoom(`project:${issue.projectId}`, {
      type: 'approval:request:updated',
      projectId: issue.projectId,
      requestId,
      issueId: issue.id,
      status: 'REJECTED',
    });
  } else {
    // Check if we have enough approvals now
    const approvedVotes = request.votes.filter((v) => v.decision === 'APPROVED').length + 1;

    if (approvedVotes >= request.approvalGate.minApprovals) {
      // Move the issue and resolve the request in a transaction
      await prisma.$transaction(async (tx) => {
        await tx.approvalRequest.update({
          where: { id: requestId },
          data: { status: 'APPROVED', resolvedAt: new Date() },
        });

        await tx.issue.update({
          where: { id: issue.id },
          data: { columnId: request.targetColumnId },
        });
      });

      // Log activity
      await logActivity('issue', issue.id, 'status_changed', userId, {
        fromColumnId: issue.columnId,
        toColumnId: request.targetColumnId,
        via: 'approval',
        requestId,
      });

      // Notify requester
      try {
        await createNotification(
          request.requestedById,
          'approval:approved',
          `Approval granted for ${issueKey}`,
          `Your request to move "${issue.title}" was approved`,
        );
      } catch (err) {
        logger.warn(
          'Failed to send approval granted notification',
          {},
          err instanceof Error ? err : undefined,
        );
      }

      broadcastToRoom(`project:${issue.projectId}`, {
        type: 'approval:request:updated',
        projectId: issue.projectId,
        requestId,
        issueId: issue.id,
        status: 'APPROVED',
      });

      // Also broadcast board move
      broadcastToRoom(`project:${issue.projectId}`, {
        type: 'board:moved',
        projectId: issue.projectId,
        issueId: issue.id,
      });
    } else {
      // More approvals needed — broadcast progress update
      broadcastToRoom(`project:${issue.projectId}`, {
        type: 'approval:request:updated',
        projectId: issue.projectId,
        requestId,
        issueId: issue.id,
        status: 'PENDING',
      });
    }
  }

  return vote;
}

/**
 * Cancel an approval request. Only the original requester can cancel.
 * @param requestId
 * @param userId
 * @throws {AppError} 404 if not found
 * @throws {AppError} 403 if not the requester
 * @throws {AppError} 400 if not pending
 */
export async function cancelRequest(requestId: string, userId: string) {
  const request = await findOrThrow(
    prisma.approvalRequest.findUnique({
      where: { id: requestId },
      select: {
        id: true,
        requestedById: true,
        status: true,
        issueId: true,
        issue: { select: { projectId: true } },
      },
    }),
    'Approval request not found',
  );

  if (request.requestedById !== userId) {
    throw new AppError(403, 'Only the requester can cancel this approval request');
  }

  if (request.status !== 'PENDING') {
    throw new AppError(400, 'Only pending requests can be cancelled');
  }

  await prisma.approvalRequest.update({
    where: { id: requestId },
    data: { status: 'CANCELLED', resolvedAt: new Date() },
  });

  broadcastToRoom(`project:${request.issue.projectId}`, {
    type: 'approval:request:updated',
    projectId: request.issue.projectId,
    requestId,
    issueId: request.issueId,
    status: 'CANCELLED',
  });
}
