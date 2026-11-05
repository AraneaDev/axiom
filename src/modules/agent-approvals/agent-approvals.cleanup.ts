import { Prisma } from '@prisma/client';

import { prisma } from '../../config/database';

/** How long a decided request keeps its input and result. The row stays as a record. */
const KEEP_CONTENT_MS = 30 * 24 * 60 * 60 * 1000;

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
