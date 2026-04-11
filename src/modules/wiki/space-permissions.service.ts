import { SpacePermissionLevel } from '@prisma/client';

import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { ERR } from '../../utils/error-messages';
import { USER_WITH_AVATAR_SELECT } from '../../utils/prisma-selects';

const LEVEL_HIERARCHY: Record<SpacePermissionLevel, number> = {
  VIEW: 1,
  EDIT: 2,
  ADMIN: 3,
};

/**
 * Check whether a user can access a space at the required permission level.
 * If no custom permissions exist on the space, all team members have full access.
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
  // 1. Count custom permissions on space
  const permCount = await prisma.spacePermission.count({ where: { spaceId } });

  // 2. If no custom permissions, all team members have full access
  if (permCount === 0) return true;

  // 3. Get user's team role via TeamMember lookup
  const space = await prisma.wikiSpace.findUnique({
    where: { id: spaceId },
    select: { teamId: true },
  });
  if (!space) return false;

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
    return prisma.spacePermission.upsert({
      where: { spaceId_userId: { spaceId, userId: data.userId } },
      create: { spaceId, userId: data.userId, level: data.level },
      update: { level: data.level },
      include: {
        user: {
          select: USER_WITH_AVATAR_SELECT,
        },
      },
    });
  }

  return prisma.spacePermission.upsert({
    where: { spaceId_teamRole: { spaceId, teamRole: data.teamRole! } },
    create: { spaceId, teamRole: data.teamRole!, level: data.level },
    update: { level: data.level },
    include: {
      user: {
        select: USER_WITH_AVATAR_SELECT,
      },
    },
  });
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
}
