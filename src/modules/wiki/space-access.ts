/**
 * Who can open a wiki space, at what level. Kept apart from the permission writes so that what
 * reads access (the realtime servers, rbac, the service account guards) never imports what
 * writes permissions and runs the guards after them.
 */
import type { Prisma, SpacePermissionLevel } from '@prisma/client';

import { prisma } from '../../config/database';
import { hasPermission, type Action } from '../../utils/permissions';

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

/** The reads canAccessSpace makes: the client, or a transaction that wants its own writes seen */
export type SpaceAccessDb = Pick<
  Prisma.TransactionClient,
  'user' | 'wikiSpace' | 'orgMembership' | 'teamMembership' | 'spacePermission'
>;

async function roleAllowsSpaceLevel(
  spaceId: string,
  userId: string,
  level: SpacePermissionLevel,
  db: SpaceAccessDb,
): Promise<boolean> {
  const space = await db.wikiSpace.findUnique({
    where: { id: spaceId },
    select: { teamId: true, team: { select: { orgId: true } } },
  });
  if (!space) return false;
  const [orgMembership, teamMembership] = await Promise.all([
    db.orgMembership.findUnique({
      where: { userId_orgId: { userId, orgId: space.team.orgId } },
    }),
    db.teamMembership.findUnique({
      where: { userId_teamId: { userId, teamId: space.teamId } },
    }),
  ]);
  if (!orgMembership) return false;
  // A team's wiki follows the team, like its projects: without a role on the team only org
  // OWNERs and ADMINs get in (platform admins pass earlier). With a role, the team role wins.
  if (!teamMembership) return orgMembership.role === 'OWNER' || orgMembership.role === 'ADMIN';
  return hasPermission(orgMembership.role, teamMembership.role, LEVEL_ACTION[level]);
}

/**
 * Check whether a user can access a space at the required permission level.
 * If no custom permissions exist on the space, it follows its team: team members by their
 * team role (org OWNERs and ADMINs keep full rights), nobody else.
 * If custom permissions exist, checks both direct user permission and team role permission,
 * taking the highest granted level.
 * @param spaceId - The space to check access for
 * @param userId - The user to check
 * @param requiredLevel - The minimum permission level required
 * @param db - The client to read with: a transaction, to see its own uncommitted writes
 * @returns True if the user has at least the required level
 */
export async function canAccessSpace(
  spaceId: string,
  userId: string,
  requiredLevel: SpacePermissionLevel,
  db: SpaceAccessDb = prisma,
): Promise<boolean> {
  // 0. Platform superadmins bypass all permission checks
  const user = await db.user.findUnique({ where: { id: userId }, select: { isAdmin: true } });
  if (user?.isAdmin) return true;

  // 1. Count custom permissions on space
  const permCount = await db.spacePermission.count({ where: { spaceId } });

  // 2. No custom permissions: the role matrix decides (src/utils/permissions.ts). Reading
  // needs wiki:view and editing wiki:edit, by org role or the role in the space's team;
  // administering needs team:manage_members (org OWNER/ADMIN or team ADMIN)
  if (permCount === 0) return roleAllowsSpaceLevel(spaceId, userId, requiredLevel, db);

  // 3. Get user's team role via TeamMember lookup
  const space = await db.wikiSpace.findUnique({
    where: { id: spaceId },
    select: { teamId: true, team: { select: { orgId: true } } },
  });
  if (!space) return false;

  // 3b. Org OWNER/ADMIN have full access to all spaces in their org
  const orgMembership = await db.orgMembership.findUnique({
    where: { userId_orgId: { userId, orgId: space.team.orgId } },
  });
  if (orgMembership && (orgMembership.role === 'OWNER' || orgMembership.role === 'ADMIN')) {
    return true;
  }

  const teamMembership = await db.teamMembership.findUnique({
    where: { userId_teamId: { userId, teamId: space.teamId } },
  });

  // 4. Check direct user permission AND team role permission
  const permissions = await db.spacePermission.findMany({
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
