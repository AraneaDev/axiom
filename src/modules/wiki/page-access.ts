/**
 * Who can open a wiki page under its restrictions. Kept apart from the restriction writes so
 * that what reads access (the realtime servers, rbac) never imports what writes restrictions and
 * runs the service account guards after them.
 */
import { RestrictionType } from '@prisma/client';

import { prisma } from '../../config/database';

/**
 * Check if a user can view a page.
 * If no VIEW restrictions exist, all team members can view.
 * If VIEW restrictions exist, only listed users and org owners/admins can view.
 * @param userId - The user to check
 * @param pageId - The page to check access for
 * @returns True if the user can view the page
 */
export async function canViewPage(userId: string, pageId: string): Promise<boolean> {
  const viewRestrictions = await prisma.pageRestriction.findMany({
    where: { pageId, type: RestrictionType.VIEW },
  });

  // No view restrictions -- everyone with team access can view
  if (viewRestrictions.length === 0) return true;

  // Check if user is in the explicit list
  if (viewRestrictions.some((r) => r.userId === userId)) return true;

  // Check if user is org owner/admin (bypasses restrictions)
  return isOrgPrivileged(userId, pageId);
}

/**
 * Check if a user can edit a page.
 * VIEW restriction implies EDIT restriction.
 * If no EDIT restrictions exist, all team members can edit (unless VIEW-restricted).
 * If EDIT restrictions exist, only listed users and org owners/admins can edit.
 * @param userId - The user to check
 * @param pageId - The page to check access for
 * @returns True if the user can edit the page
 */
export async function canEditPage(userId: string, pageId: string): Promise<boolean> {
  // VIEW restriction implies EDIT restriction -- must pass view check first
  const canView = await canViewPage(userId, pageId);
  if (!canView) return false;

  const editRestrictions = await prisma.pageRestriction.findMany({
    where: { pageId, type: RestrictionType.EDIT },
  });

  // No edit restrictions -- everyone who can view can edit
  if (editRestrictions.length === 0) return true;

  // Check if user is in the explicit list
  if (editRestrictions.some((r) => r.userId === userId)) return true;

  // Check if user is org owner/admin (bypasses restrictions)
  return isOrgPrivileged(userId, pageId);
}

/**
 * Pages in a space that a VIEW restriction hides from the user, for listings (tree, space,
 * children). Same rule as canViewPage: listed users and org owners/admins see everything.
 * @param userId - The user
 * @param spaceId - The space
 * @returns Ids of the pages to leave out
 */
export async function hiddenPageIds(userId: string, spaceId: string): Promise<Set<string>> {
  const restrictions = await prisma.pageRestriction.findMany({
    where: { type: RestrictionType.VIEW, page: { spaceId } },
    select: { pageId: true, userId: true },
  });
  if (restrictions.length === 0) return new Set();

  const space = await prisma.wikiSpace.findUnique({
    where: { id: spaceId },
    select: { team: { select: { orgId: true } } },
  });
  if (space) {
    const membership = await prisma.orgMembership.findUnique({
      where: { userId_orgId: { userId, orgId: space.team.orgId } },
    });
    if (membership?.role === 'OWNER' || membership?.role === 'ADMIN') return new Set();
  }

  const allowed = new Set(restrictions.filter((r) => r.userId === userId).map((r) => r.pageId));
  return new Set(restrictions.map((r) => r.pageId).filter((id) => !allowed.has(id)));
}

/**
 * Drop hidden pages, and everything under them, from a page tree.
 * @param nodes - Tree nodes with id and children
 * @param hidden - Ids from hiddenPageIds
 */
export function pruneHiddenPages<T extends { id: string; children: T[] }>(
  nodes: T[],
  hidden: Set<string>,
): T[] {
  if (hidden.size === 0) return nodes;
  return nodes
    .filter((n) => !hidden.has(n.id))
    .map((n) => ({ ...n, children: pruneHiddenPages(n.children, hidden) }));
}

/**
 * Check whether a user is an org OWNER or ADMIN for the org that owns the page.
 * Org owners/admins bypass all page restrictions.
 * @param userId - The user to check
 * @param pageId - The page (used to resolve org)
 * @returns True if user is OWNER or ADMIN in the page's org
 */
async function isOrgPrivileged(userId: string, pageId: string): Promise<boolean> {
  const page = await prisma.page.findUnique({
    where: { id: pageId },
    select: { space: { select: { team: { select: { orgId: true } } } } },
  });
  if (!page) return false;

  const orgMembership = await prisma.orgMembership.findUnique({
    where: { userId_orgId: { userId, orgId: page.space.team.orgId } },
  });

  return orgMembership?.role === 'OWNER' || orgMembership?.role === 'ADMIN';
}
