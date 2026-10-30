/**
 * What a searcher may find: the same rules the REST routes apply when opening a result.
 * Issues need project access (team membership, or system admin, as requireProjectAccess).
 * Pages need org membership, VIEW access to their space (canAccessSpace) and no VIEW
 * restriction that leaves the searcher out (canViewPage).
 */
import { Prisma } from '@prisma/client';

import { prisma } from '../../config/database';
import { canAccessSpace } from '../wiki/space-permissions.service';

/**
 * Prisma filter for issues the user can open.
 * @param userId - The searcher
 */
export async function viewableIssuesWhere(userId: string): Promise<Prisma.IssueWhereInput> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { isAdmin: true } });
  if (user?.isAdmin) return {};
  return { project: { team: { members: { some: { userId } } } } };
}

/**
 * Spaces the user can view: in one of their orgs and passing canAccessSpace at VIEW.
 * @param userId - The searcher
 * @param opts - includeArchived for searching, false for the filter list
 * @param opts.includeArchived
 */
export async function viewableSpaces(
  userId: string,
  opts: { includeArchived: boolean },
): Promise<Array<{ id: string; name: string; slug: string }>> {
  const spaces = await prisma.wikiSpace.findMany({
    where: {
      team: { org: { members: { some: { userId } } } },
      ...(opts.includeArchived ? {} : { isArchived: false }),
    },
    select: { id: true, name: true, slug: true },
    orderBy: { name: 'asc' },
  });
  const allowed = await Promise.all(spaces.map((s) => canAccessSpace(s.id, userId, 'VIEW')));
  return spaces.filter((_, i) => allowed[i]);
}

/**
 * Prisma filter for pages the user can open.
 * @param userId - The searcher
 */
export async function viewablePagesWhere(userId: string): Promise<Prisma.PageWhereInput> {
  const spaceIds = (await viewableSpaces(userId, { includeArchived: true })).map((s) => s.id);
  // Org OWNERs and ADMINs pass page restrictions, as in canViewPage
  const privileged = await prisma.orgMembership.findMany({
    where: { userId, role: { in: ['OWNER', 'ADMIN'] } },
    select: { orgId: true },
  });
  return {
    spaceId: { in: spaceIds },
    OR: [
      { restrictions: { none: { type: 'VIEW' } } },
      { restrictions: { some: { type: 'VIEW', userId } } },
      { space: { team: { orgId: { in: privileged.map((m) => m.orgId) } } } },
    ],
  };
}
