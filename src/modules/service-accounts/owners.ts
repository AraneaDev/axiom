import type { Prisma } from '@prisma/client';

import { prisma } from '../../config/database';

/** Org roles that may own a bot: a person with one of these, not deactivated */
export const OWNER_ROLES = ['OWNER', 'ADMIN', 'MEMBER'] as const;

/**
 * The users who can own a bot of an org now: people, not deactivated, with org role OWNER, ADMIN
 * or MEMBER there. An owner row of anyone else counts for nothing until the orphan check removes
 * it, so a lapse path that check misses never leaves someone deciding.
 * @param orgId - The bot's org
 */
export function eligibleOwnerWhere(orgId: string): Prisma.UserWhereInput {
  return {
    kind: 'PERSON',
    deactivatedAt: null,
    orgMemberships: { some: { orgId, role: { in: [...OWNER_ROLES] } } },
  };
}

/**
 * The owners of a bot who count: its owner rows, filtered by eligibility. None for a user that is
 * no bot.
 * @param botId - The bot's user id
 * @returns Their ids, oldest owner first
 */
export async function eligibleOwnerIds(botId: string): Promise<string[]> {
  const bot = await prisma.serviceAccount.findUnique({
    where: { userId: botId },
    select: { orgId: true },
  });
  if (!bot) return [];
  const rows = await prisma.serviceAccountOwner.findMany({
    where: { serviceAccountId: botId, owner: eligibleOwnerWhere(bot.orgId) },
    select: { ownerId: true },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((r) => r.ownerId);
}

/** A bot as its owner sees it in the approvals list. */
export interface OwnedBot {
  id: string;
  orgId: string;
  displayName: string;
}

/**
 * The bots a user owns and may answer for now: owner rows in orgs where the user is an eligible
 * owner.
 * @param userId - The user
 */
export async function botsOwnedBy(userId: string): Promise<OwnedBot[]> {
  const rows = await prisma.serviceAccountOwner.findMany({
    where: { ownerId: userId },
    select: {
      serviceAccount: {
        select: { userId: true, orgId: true, user: { select: { displayName: true } } },
      },
    },
  });
  if (rows.length === 0) return [];
  const orgIds = [...new Set(rows.map((r) => r.serviceAccount.orgId))];
  const eligibleIn = await prisma.orgMembership.findMany({
    where: {
      userId,
      orgId: { in: orgIds },
      role: { in: [...OWNER_ROLES] },
      user: { kind: 'PERSON', deactivatedAt: null },
    },
    select: { orgId: true },
  });
  const orgs = new Set(eligibleIn.map((m) => m.orgId));
  return rows
    .filter((r) => orgs.has(r.serviceAccount.orgId))
    .map((r) => ({
      id: r.serviceAccount.userId,
      orgId: r.serviceAccount.orgId,
      displayName: r.serviceAccount.user.displayName,
    }));
}
