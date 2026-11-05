/**
 * The sharing rules for what a user saves and others may open: saved queries now, dashboards
 * next. One place, so the two cannot drift apart.
 *
 * - View: the creator, members of the team a TEAM item is shared with, members of the org an ORG
 *   item is shared with, and platform admins. Whoever may not view an item gets a 404.
 * - Edit and delete: the creator; for TEAM also that team's ADMIN; for ORG also the org's OWNER or
 *   ADMIN; platform admins always. Someone who may view but not edit gets a 403.
 * - Sharing with a team or org needs membership of it (a platform admin may share anywhere).
 */
import type { SavedVisibility } from '@prisma/client';

import { prisma } from '../config/database';
import { AppError } from '../middleware/errorHandler';

export type Visibility = SavedVisibility;

/** What the rules read of a shared row */
export interface SharedRow {
  visibility: Visibility;
  teamId: string | null;
  orgId: string | null;
}

/** The sharing part of an item as a client states it */
export interface SharingInput {
  visibility: Visibility;
  teamId?: string | null;
  orgId?: string | null;
}

const NOT_FOUND = 'Not found';

async function isPlatformAdmin(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { isAdmin: true } });
  return user?.isAdmin === true;
}

/**
 * The where clause for the items a user sees in a list: their own, and those shared with a team
 * or org they belong to. Platform admins get no extra rows in a list; they reach any one by id.
 * @param userId - The viewer
 * @param ownerField - The column that names the creator
 */
export function sharedWith(
  userId: string,
  ownerField = 'userId',
): {
  OR: Array<Record<string, unknown>>;
} {
  return {
    OR: [
      { [ownerField]: userId },
      { visibility: 'TEAM', team: { members: { some: { userId } } } },
      { visibility: 'ORG', org: { members: { some: { userId } } } },
    ],
  };
}

/**
 * Whether a user may open an item.
 * @param userId - The viewer
 * @param row - The item's sharing
 * @param ownerId - The item's creator
 */
export async function canView(userId: string, row: SharedRow, ownerId: string): Promise<boolean> {
  if (ownerId === userId) return true;
  if (row.visibility === 'TEAM' && row.teamId) {
    const member = await prisma.teamMembership.findUnique({
      where: { userId_teamId: { userId, teamId: row.teamId } },
      select: { id: true },
    });
    if (member) return true;
  }
  if (row.visibility === 'ORG' && row.orgId) {
    const member = await prisma.orgMembership.findUnique({
      where: { userId_orgId: { userId, orgId: row.orgId } },
      select: { id: true },
    });
    if (member) return true;
  }
  return isPlatformAdmin(userId);
}

/**
 * Whether a user may change or delete an item.
 * @param userId - The user
 * @param row - The item's sharing
 * @param ownerId - The item's creator
 */
export async function canEdit(userId: string, row: SharedRow, ownerId: string): Promise<boolean> {
  if (ownerId === userId) return true;
  if (row.visibility === 'TEAM' && row.teamId) {
    const member = await prisma.teamMembership.findUnique({
      where: { userId_teamId: { userId, teamId: row.teamId } },
      select: { role: true },
    });
    if (member?.role === 'ADMIN') return true;
  }
  if (row.visibility === 'ORG' && row.orgId) {
    const member = await prisma.orgMembership.findUnique({
      where: { userId_orgId: { userId, orgId: row.orgId } },
      select: { role: true },
    });
    if (member && (member.role === 'OWNER' || member.role === 'ADMIN')) return true;
  }
  return isPlatformAdmin(userId);
}

/**
 * What decides edit rights for many rows at once: the user's roles loaded once, so a list does not
 * look them up per row. The returned function answers as canEdit does.
 * @param userId - The user
 */
export async function editRightsOf(
  userId: string,
): Promise<(row: SharedRow, ownerId: string) => boolean> {
  const [admin, teams, orgs] = await Promise.all([
    isPlatformAdmin(userId),
    prisma.teamMembership.findMany({ where: { userId }, select: { teamId: true, role: true } }),
    prisma.orgMembership.findMany({ where: { userId }, select: { orgId: true, role: true } }),
  ]);
  const teamAdmin = new Set(teams.filter((t) => t.role === 'ADMIN').map((t) => t.teamId));
  const orgAdmin = new Set(
    orgs.filter((o) => o.role === 'OWNER' || o.role === 'ADMIN').map((o) => o.orgId),
  );
  return (row, ownerId) =>
    admin ||
    ownerId === userId ||
    (row.visibility === 'TEAM' && !!row.teamId && teamAdmin.has(row.teamId)) ||
    (row.visibility === 'ORG' && !!row.orgId && orgAdmin.has(row.orgId));
}

/**
 * Throw the 404 for an item the user may not open, and the 403 for one they may open and not
 * change.
 * @param userId - The user
 * @param row - The item, or null when it does not exist
 * @param ownerId - The item's creator
 * @param need - 'view' or 'edit'
 * @param what - The thing's name for messages, e.g. 'Saved query'
 */
export async function assertAccess<R extends SharedRow>(
  userId: string,
  row: R | null,
  ownerId: string | undefined,
  need: 'view' | 'edit',
  what: string,
): Promise<R> {
  if (!row || ownerId === undefined || !(await canView(userId, row, ownerId))) {
    throw new AppError(404, `${what} ${NOT_FOUND.toLowerCase()}`);
  }
  if (need === 'edit' && !(await canEdit(userId, row, ownerId))) {
    throw new AppError(403, `You cannot change this ${what.toLowerCase()}`, 'FORBIDDEN');
  }
  return row;
}

/**
 * Check a user may give an item this sharing and return what to store: PRIVATE keeps no team or
 * org, TEAM exactly the team, ORG exactly the org.
 * @param userId - The user sharing
 * @param sharing - The visibility asked for and the team or org it names
 * @throws {AppError} 400 when the team or org is missing, 404 when it does not exist or the user
 * is not in it
 */
export async function resolveSharing(
  userId: string,
  sharing: SharingInput,
): Promise<{ visibility: Visibility; teamId: string | null; orgId: string | null }> {
  if (sharing.visibility === 'PRIVATE') return { visibility: 'PRIVATE', teamId: null, orgId: null };
  const admin = await isPlatformAdmin(userId);
  if (sharing.visibility === 'TEAM') {
    if (!sharing.teamId) throw new AppError(400, 'teamId is required to share with a team');
    const team = await prisma.team.findFirst({
      where: { id: sharing.teamId, ...(admin ? {} : { members: { some: { userId } } }) },
      select: { id: true },
    });
    if (!team) throw new AppError(404, 'Team not found');
    return { visibility: 'TEAM', teamId: team.id, orgId: null };
  }
  if (!sharing.orgId) throw new AppError(400, 'orgId is required to share with an org');
  const org = await prisma.organization.findFirst({
    where: { id: sharing.orgId, ...(admin ? {} : { members: { some: { userId } } }) },
    select: { id: true },
  });
  if (!org) throw new AppError(404, 'Organization not found');
  return { visibility: 'ORG', teamId: null, orgId: org.id };
}

/**
 * What to store when an item's sharing changes: nothing without a visibility. A team or org left
 * out stays as it was, when the visibility still calls for one.
 * @param userId - The user changing it
 * @param current - The item as it is
 * @param change - The visibility asked for and the team or org it names
 * @param change.visibility
 * @param change.teamId
 * @param change.orgId
 * @throws {AppError} 400 for a team or org without a visibility, and as resolveSharing
 */
export async function resolveSharingChange(
  userId: string,
  current: SharedRow,
  change: { visibility?: Visibility; teamId?: string; orgId?: string },
): Promise<Partial<SharedRow>> {
  const { visibility, teamId, orgId } = change;
  if (!visibility) {
    if (teamId || orgId) throw new AppError(400, 'teamId and orgId need a visibility to go with');
    return {};
  }
  return resolveSharing(userId, {
    visibility,
    teamId: teamId ?? (visibility === 'TEAM' ? current.teamId : null),
    orgId: orgId ?? (visibility === 'ORG' ? current.orgId : null),
  });
}
