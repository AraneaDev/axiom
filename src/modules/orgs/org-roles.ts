import type { OrgRole, Prisma } from '@prisma/client';

import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';

/** Org roles from most to least powerful. */
const RANK: Record<OrgRole, number> = { OWNER: 5, ADMIN: 4, MEMBER: 3, VIEWER: 2, GUEST: 1 };

async function isPlatformAdmin(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { isAdmin: true } });
  return user?.isAdmin === true;
}

async function actorRole(orgId: string, actorId: string): Promise<OrgRole | null> {
  const membership = await prisma.orgMembership.findUnique({
    where: { userId_orgId: { userId: actorId, orgId } },
    select: { role: true },
  });
  return membership?.role ?? null;
}

/**
 * Nobody can hand out more than they hold: an ADMIN can grant up to ADMIN, only an OWNER
 * can make OWNERs. Used for adding members, changing roles and every kind of invite.
 * @param orgId
 * @param actorId - The user granting the role
 * @param role - The role being granted
 * @throws {AppError} 403 when the role outranks the actor's
 */
export async function assertCanGrantOrgRole(
  orgId: string,
  actorId: string,
  role: OrgRole,
): Promise<void> {
  // Platform admins can grant any role, OWNER included, so ownership can be transferred
  if (await isPlatformAdmin(actorId)) return;
  const actor = await actorRole(orgId, actorId);
  if (!actor || RANK[role] > RANK[actor]) {
    throw new AppError(
      403,
      `Only a ${role === 'OWNER' ? 'OWNER' : 'higher role'} can grant ${role}`,
    );
  }
}

/**
 * An OWNER can only be demoted or removed by an OWNER.
 * @param orgId
 * @param actorId - The user making the change
 * @param targetRole - The current role of the member being changed
 * @throws {AppError} 403 when an OWNER would be changed by a non-OWNER
 */
export async function assertCanManageOrgMember(
  orgId: string,
  actorId: string,
  targetRole: OrgRole,
): Promise<void> {
  if (targetRole !== 'OWNER') return;
  if (await isPlatformAdmin(actorId)) return;
  if ((await actorRole(orgId, actorId)) !== 'OWNER') {
    throw new AppError(403, 'Only an OWNER can change or remove an OWNER');
  }
}

/**
 * Run a change to an org's owners with the OWNER rows locked, so two concurrent demotions
 * (or a demotion and a removal) can't each see two OWNERs and leave none. The callback
 * re-checks with assertNotLastOwnerTx inside the same transaction.
 * @param orgId
 * @param fn - The change, given the transaction client
 */
export async function withOwnersLocked<T>(
  orgId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM org_memberships WHERE "orgId" = ${orgId} AND role = 'OWNER' FOR UPDATE`;
    return fn(tx);
  });
}

/**
 * The last-OWNER check inside a withOwnersLocked transaction.
 * @param tx
 * @param orgId
 * @throws {AppError} 400 when the change would leave the org without an OWNER
 */
export async function assertNotLastOwnerTx(
  tx: Prisma.TransactionClient,
  orgId: string,
): Promise<void> {
  const owners = await tx.orgMembership.count({ where: { orgId, role: 'OWNER' } });
  if (owners <= 1) {
    throw new AppError(
      400,
      'An organization must keep at least one OWNER: transfer ownership first (make another member OWNER)',
    );
  }
}

/**
 * The role an invite link grants when it is redeemed: never more than its creator holds now.
 * Links minted before roles were capped (an ADMIN's OWNER link), or whose creator has since
 * been demoted or left, grant the creator's current role (MEMBER if they left).
 * @param orgId
 * @param createdBy - The link's creator
 * @param role - The role on the link
 */
export async function redeemableInviteRole(
  orgId: string,
  createdBy: string,
  role: OrgRole,
): Promise<OrgRole> {
  const creator = await actorRole(orgId, createdBy);
  const ceiling: OrgRole = creator ?? 'MEMBER';
  return RANK[role] > RANK[ceiling] ? ceiling : role;
}
