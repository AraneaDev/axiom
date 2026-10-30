import { SpacePermissionLevel } from '@prisma/client';

import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { revokeLiveAccess } from '../../realtime/access-revocation';
import { ERR } from '../../utils/error-messages';
import { hasPermission, type Action } from '../../utils/permissions';
import { USER_WITH_AVATAR_SELECT } from '../../utils/prisma-selects';

const LEVEL_HIERARCHY: Record<SpacePermissionLevel, number> = {
  VIEW: 1,
  EDIT: 2,
  ADMIN: 3,
};

const LEVEL_ACTION: Record<SpacePermissionLevel, Action> = {
  VIEW: 'wiki:view',
  EDIT: 'wiki:edit',
  ADMIN: 'team:manage_members',
};

async function roleAllowsSpaceLevel(
  spaceId: string,
  userId: string,
  level: SpacePermissionLevel,
): Promise<boolean> {
  const space = await prisma.wikiSpace.findUnique({
    where: { id: spaceId },
    select: { teamId: true, team: { select: { orgId: true } } },
  });
  if (!space) return false;
  const [orgMembership, teamMembership] = await Promise.all([
    prisma.orgMembership.findUnique({
      where: { userId_orgId: { userId, orgId: space.team.orgId } },
    }),
    prisma.teamMembership.findUnique({
      where: { userId_teamId: { userId, teamId: space.teamId } },
    }),
  ]);
  if (!orgMembership) return false;
  return hasPermission(orgMembership.role, teamMembership?.role ?? null, LEVEL_ACTION[level]);
}

/**
 * Check whether a user can access a space at the required permission level.
 * If no custom permissions exist on the space, the role matrix decides (org role or the
 * role in the space's team).
 * If custom permissions exist, checks both direct user permission and team role permission,
 * taking the highest granted level.
 * @param spaceId - The space to check access for
 * @param userId - The user to check
 * @param requiredLevel - The minimum permission level required
 * @returns True if the user has at least the required level
 */
export async function canAccessSpace(
  spaceId: string,
  userId: string,
  requiredLevel: SpacePermissionLevel,
): Promise<boolean> {
  // 0. Platform superadmins bypass all permission checks
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { isAdmin: true } });
  if (user?.isAdmin) return true;

  // 1. Count custom permissions on space
  const permCount = await prisma.spacePermission.count({ where: { spaceId } });

  // 2. No custom permissions: the role matrix decides (src/utils/permissions.ts). Reading
  // needs wiki:view and editing wiki:edit, by org role or the role in the space's team;
  // administering needs team:manage_members (org OWNER/ADMIN or team ADMIN)
  if (permCount === 0) return roleAllowsSpaceLevel(spaceId, userId, requiredLevel);

  // 3. Get user's team role via TeamMember lookup
  const space = await prisma.wikiSpace.findUnique({
    where: { id: spaceId },
    select: { teamId: true, team: { select: { orgId: true } } },
  });
  if (!space) return false;

  // 3b. Org OWNER/ADMIN have full access to all spaces in their org
  const orgMembership = await prisma.orgMembership.findUnique({
    where: { userId_orgId: { userId, orgId: space.team.orgId } },
  });
  if (orgMembership && (orgMembership.role === 'OWNER' || orgMembership.role === 'ADMIN')) {
    return true;
  }

  const teamMembership = await prisma.teamMembership.findUnique({
    where: { userId_teamId: { userId, teamId: space.teamId } },
  });

  // 4. Check direct user permission AND team role permission
  const permissions = await prisma.spacePermission.findMany({
    where: {
      spaceId,
      OR: [{ userId }, ...(teamMembership ? [{ teamRole: teamMembership.role }] : [])],
    },
  });

  if (permissions.length === 0) return false;

  // 5. Take highest granted level, compare to required
  const highestLevel = permissions.reduce((max, p) => {
    const val = LEVEL_HIERARCHY[p.level];
    return val > max ? val : max;
  }, 0);

  return highestLevel >= LEVEL_HIERARCHY[requiredLevel];
}

/**
 * Get all permissions for a space, including user details.
 * @param spaceId - The space to get permissions for
 * @returns List of space permissions with user details
 */
export async function getSpacePermissions(spaceId: string) {
  return prisma.spacePermission.findMany({
    where: { spaceId },
    include: {
      user: {
        select: USER_WITH_AVATAR_SELECT,
      },
    },
    orderBy: { createdAt: 'asc' },
  });
}

/**
 * Upsert a space permission by userId or teamRole.
 * @param spaceId - The space to set the permission on
 * @param data - The permission data (userId or teamRole, plus level)
 * @param data.userId
 * @param data.teamRole
 * @param data.level
 * @returns The upserted permission record
 */
export async function setSpacePermission(
  spaceId: string,
  data: { userId?: string; teamRole?: string; level: SpacePermissionLevel },
) {
  // Verify space exists
  const space = await prisma.wikiSpace.findUnique({ where: { id: spaceId } });
  if (!space) throw new AppError(404, 'Wiki space not found');

  if (!data.userId && !data.teamRole) {
    throw new AppError(400, 'Either userId or teamRole is required');
  }

  if (data.userId) {
    const permission = await prisma.spacePermission.upsert({
      where: { spaceId_userId: { spaceId, userId: data.userId } },
      create: { spaceId, userId: data.userId, level: data.level },
      update: { level: data.level },
      include: {
        user: {
          select: USER_WITH_AVATAR_SELECT,
        },
      },
    });
    // Any permission can take access away: the first one closes an open space to everyone
    // not listed, and a lower level ends editing (re-check not awaited)
    void revokeLiveAccess({ spaceId });
    return permission;
  }

  const permission = await prisma.spacePermission.upsert({
    where: { spaceId_teamRole: { spaceId, teamRole: data.teamRole! } },
    create: { spaceId, teamRole: data.teamRole!, level: data.level },
    update: { level: data.level },
    include: {
      user: {
        select: USER_WITH_AVATAR_SELECT,
      },
    },
  });
  void revokeLiveAccess({ spaceId });
  return permission;
}

/**
 * Remove a single space permission by ID.
 * @param spaceId - The space the permission belongs to (for verification)
 * @param permissionId - The permission record to remove
 */
export async function removeSpacePermission(spaceId: string, permissionId: string): Promise<void> {
  const permission = await prisma.spacePermission.findUnique({
    where: { id: permissionId },
  });
  if (!permission) throw new AppError(404, ERR.PERMISSION_NOT_FOUND);
  if (permission.spaceId !== spaceId) {
    throw new AppError(403, 'Permission does not belong to this space');
  }

  await prisma.spacePermission.delete({ where: { id: permissionId } });
  // Removing a grant can take access away from its user or team role (not awaited)
  void revokeLiveAccess({ spaceId });
}
