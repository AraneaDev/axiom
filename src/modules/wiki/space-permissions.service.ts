import { Prisma, SpacePermissionLevel } from '@prisma/client';

import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { revokeLiveAccess } from '../../realtime/access-revocation';
import { ERR } from '../../utils/error-messages';
import { USER_WITH_AVATAR_SELECT } from '../../utils/prisma-selects';
import {
  assertBotRole,
  assertOwnerPresent,
  isBotUser,
  lockServiceAccount,
  onSpaceChanged,
} from '../service-accounts/bot-guards';

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

  // A grant to a user needs that user to exist and to belong to the space's org
  if (data.userId) {
    const team = await prisma.team.findUnique({
      where: { id: space.teamId },
      select: { orgId: true },
    });
    const user = await prisma.user.findUnique({ where: { id: data.userId }, select: { id: true } });
    if (!user) throw new AppError(404, 'User not found');
    const membership = await prisma.orgMembership.findUnique({
      where: { userId_orgId: { userId: data.userId, orgId: team!.orgId } },
    });
    if (!membership) throw new AppError(403, "User is not a member of the space's organization");
  }

  if (data.userId) {
    const userId = data.userId;
    const upsert = (db: Pick<Prisma.TransactionClient, 'spacePermission'>) =>
      db.spacePermission.upsert({
        where: { spaceId_userId: { spaceId, userId } },
        create: { spaceId, userId, level: data.level },
        update: { level: data.level },
        include: {
          user: {
            select: USER_WITH_AVATAR_SELECT,
          },
        },
      });
    // A bot holds at most edit, and only where one of its owners can view the space with the
    // grant in place: the first grant closes the space to everyone not listed (decision 9)
    const bot = await isBotUser(prisma, userId);
    if (bot) assertBotRole(data.level);
    const permission = bot
      ? await prisma.$transaction(async (tx) => {
          // Locked before the write: a concurrent check of this bot sees the grant or waits
          await lockServiceAccount(tx, userId);
          const granted = await upsert(tx);
          await assertOwnerPresent(userId, { spaceId }, tx);
          return granted;
        })
      : await upsert(prisma);
    // Any permission can take access away: the first one closes an open space to everyone
    // not listed, and a lower level ends editing (re-check not awaited)
    void revokeLiveAccess({ spaceId });
    await onSpaceChanged(spaceId);
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
  // A grant to a team role can close the space to a bot's owners
  await onSpaceChanged(spaceId);
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
  // And from a bot's last owner there, so the bot leaves the space too (decision 9)
  await onSpaceChanged(spaceId);
}
