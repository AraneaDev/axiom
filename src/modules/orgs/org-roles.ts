import type { OrgRole } from '@prisma/client';

import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';

/** Org roles from most to least powerful. */
const RANK: Record<OrgRole, number> = { OWNER: 5, ADMIN: 4, MEMBER: 3, VIEWER: 2, GUEST: 1 };

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
  if ((await actorRole(orgId, actorId)) !== 'OWNER') {
    throw new AppError(403, 'Only an OWNER can change or remove an OWNER');
  }
}

/**
 * An org must keep at least one OWNER.
 * @param orgId
 * @throws {AppError} 400 when the change would leave the org without one
 */
export async function assertNotLastOwner(orgId: string): Promise<void> {
  const owners = await prisma.orgMembership.count({ where: { orgId, role: 'OWNER' } });
  if (owners <= 1) throw new AppError(400, 'An organization must keep at least one OWNER');
}
