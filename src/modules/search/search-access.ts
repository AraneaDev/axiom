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
 * Prisma filter for projects the user can open.
 * @param userId - The searcher
 */
export async function viewableProjectsWhere(userId: string): Promise<Prisma.ProjectWhereInput> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { isAdmin: true } });
  if (user?.isAdmin) return {};
  return { team: { members: { some: { userId } } } };
}

/**
 * Prisma filter for issues the user can open.
 * @param userId - The searcher
 */
export async function viewableIssuesWhere(userId: string): Promise<Prisma.IssueWhereInput> {
  return { project: await viewableProjectsWhere(userId) };
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

/**
 * The same issue rule as viewableIssuesWhere, as plain ids for raw SQL: the project ids the
 * user can open, or null for "all" (platform admins).
 * @param userId - The searcher
 */
export async function viewableProjectIds(userId: string): Promise<string[] | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { isAdmin: true } });
  if (user?.isAdmin) return null;
  const projects = await prisma.project.findMany({
    where: { team: { members: { some: { userId } } } },
    select: { id: true },
  });
  return projects.map((p) => p.id);
}

/**
 * The same page rule as viewablePagesWhere, as plain ids for raw SQL: the spaces the user
 * can view, and the pages in them a VIEW restriction hides from the user.
 * @param userId - The searcher
 */
export async function viewablePageIdFilter(
  userId: string,
): Promise<{ spaceIds: string[]; hiddenPageIds: string[] }> {
  const spaceIds = (await viewableSpaces(userId, { includeArchived: true })).map((s) => s.id);
  const privileged = await prisma.orgMembership.findMany({
    where: { userId, role: { in: ['OWNER', 'ADMIN'] } },
    select: { orgId: true },
  });
  const hidden = await prisma.page.findMany({
    where: {
      spaceId: { in: spaceIds },
      restrictions: { some: { type: 'VIEW' } },
      NOT: { restrictions: { some: { type: 'VIEW', userId } } },
      space: { team: { orgId: { notIn: privileged.map((m) => m.orgId) } } },
    },
    select: { id: true },
  });
  return { spaceIds, hiddenPageIds: hidden.map((p) => p.id) };
}
