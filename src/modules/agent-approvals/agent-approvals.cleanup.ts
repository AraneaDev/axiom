import { Prisma } from '@prisma/client';

import { prisma } from '../../config/database';

/** How long a decided request keeps its input and result. The row stays as a record. */
const KEEP_CONTENT_MS = 30 * 24 * 60 * 60 * 1000;

/** How long a run may take before its row counts as stuck. */
const STUCK_AFTER_MS = 60 * 60 * 1000;

/** The error of a run nobody knows the end of. */
export const OUTCOME_UNKNOWN = {
  status: 500,
  code: 'OUTCOME_UNKNOWN',
  message: 'The action may have run, but its outcome could not be recorded. Check the item itself',
};

/**
 * Close rows stuck in APPROVED: the process died during the run, or its end could not be written.
 * They never run again. A run that does end later overwrites this with what really happened.
 * @returns How many were closed
 */
export async function failStuckAgentApprovals(): Promise<number> {
  const { count } = await prisma.agentApproval.updateMany({
    where: { status: 'APPROVED', decidedAt: { lt: new Date(Date.now() - STUCK_AFTER_MS) } },
    data: { status: 'FAILED', error: OUTCOME_UNKNOWN },
  });
  return count;
}

/**
 * Mark requests past their expiry. Approving one was refused from the moment it expired, this makes
 * the row say so. Apart from the service, so the worker doesn't load the action registry.
 * @returns How many expired
 */
export async function expireAgentApprovals(): Promise<number> {
  const now = new Date();
  const { count } = await prisma.agentApproval.updateMany({
    where: { status: 'PENDING', expiresAt: { lte: now } },
    data: { status: 'EXPIRED', decidedAt: now },
  });
  return count;
}

/**
 * Clear what old decided requests held: an input and a result are no record worth keeping.
 * @returns How many were cleared
 */
export async function clearDecidedAgentApprovals(): Promise<number> {
  const { count } = await prisma.agentApproval.updateMany({
    where: {
      decidedAt: { lt: new Date(Date.now() - KEEP_CONTENT_MS) },
      OR: [{ NOT: { input: { equals: {} } } }, { NOT: { result: { equals: Prisma.DbNull } } }],
    },
    data: { input: {}, result: Prisma.DbNull },
  });
  return count;
}

/**
 * Cancel what a user's tokens wait on: for a bot deleted, suspended or orphaned, whose requests
 * nobody should approve anymore. A decided request keeps its outcome. Apart from the service, so
 * the service accounts and orgs that call it don't load the action registry.
 * @param userId - Whose requests
 * @param reason - What the approver and the agent read as the error
 * @param db - A transaction to run in, if the caller has one
 * @returns How many were cancelled
 */
export async function cancelPendingFor(
  userId: string,
  reason: string,
  db: Pick<Prisma.TransactionClient, 'agentApproval'> = prisma,
): Promise<number> {
  const { count } = await db.agentApproval.updateMany({
    where: { userId, status: 'PENDING' },
    data: {
      status: 'CANCELLED',
      decidedAt: new Date(),
      error: { status: 409, code: 'CANCELLED', message: reason },
    },
  });
  return count;
}
