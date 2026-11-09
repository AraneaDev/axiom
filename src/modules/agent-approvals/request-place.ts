import type { ActionContext, ActionDef } from '../../actions/define';
import type { PlaceRefs } from '../../actions/places';
import { prisma } from '../../config/database';
import { canViewPage } from '../wiki/page-access';
import { canAccessSpace } from '../wiki/space-access';

/**
 * Where a request acts (decision 11), as a bot's request stores it: the teams, spaces and pages the
 * action's place resolver found, and whether the action is org level. Nothing found on an action
 * that is not org level is a place nobody can open.
 */
export interface RequestPlace {
  teamIds: string[];
  spaceIds: string[];
  pageIds: string[];
  orgLevel: boolean;
}

/**
 * Ids once each, in a stable order.
 * @param ids - Ids
 */
function unique(ids: string[] | undefined): string[] {
  return [...new Set(ids ?? [])].sort();
}

/**
 * The place of one call, from what the action declares: its resolver, or orgLevel. An action that
 * declares neither (the registry rules refuse that) acts nowhere anyone can open.
 * @param def - The action
 * @param ctx - Who runs it
 * @param input - Its validated input
 */
export async function placeFor(
  def: ActionDef,
  ctx: ActionContext,
  input: unknown,
): Promise<RequestPlace> {
  const found: PlaceRefs = def.place
    ? await def.place(ctx, input)
    : { orgLevel: def.orgLevel === true };
  return {
    teamIds: unique(found.teamIds),
    spaceIds: unique(found.spaceIds),
    pageIds: unique(found.pageIds),
    orgLevel: found.orgLevel === true,
  };
}

/**
 * Whether a user can open every part of a place:
 * - a team as its projects are opened (a membership, or a platform admin);
 * - a space by its view right;
 * - a page by its space's view right and its own restrictions.
 * A place with no part is open to anyone only when the action is org level, and to nobody
 * otherwise.
 * @param userId - The user
 * @param place - The place
 */
export async function canOpenPlace(userId: string, place: RequestPlace): Promise<boolean> {
  if (place.teamIds.length === 0 && place.spaceIds.length === 0 && place.pageIds.length === 0) {
    return place.orgLevel;
  }
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { isAdmin: true } });
  if (user?.isAdmin) return true;
  if (place.teamIds.length > 0) {
    const member = await prisma.teamMembership.count({
      where: { userId, teamId: { in: place.teamIds } },
    });
    if (member !== place.teamIds.length) return false;
  }
  for (const spaceId of place.spaceIds) {
    if (!(await canAccessSpace(spaceId, userId, 'VIEW'))) return false;
  }
  if (place.pageIds.length > 0) {
    const pages = await prisma.page.findMany({
      where: { id: { in: place.pageIds } },
      select: { id: true, spaceId: true },
    });
    // A page that is gone can't be opened
    if (pages.length !== place.pageIds.length) return false;
    for (const page of pages) {
      if (!(await canAccessSpace(page.spaceId, userId, 'VIEW'))) return false;
      if (!(await canViewPage(userId, page.id))) return false;
    }
  }
  return true;
}

/**
 * The place a stored request holds.
 * @param row - The request's place columns
 * @param row.placeTeamIds
 * @param row.placeSpaceIds
 * @param row.placePageIds
 * @param row.placeOrgLevel
 */
export function placeOfRow(row: {
  placeTeamIds: string[];
  placeSpaceIds: string[];
  placePageIds: string[];
  placeOrgLevel: boolean;
}): RequestPlace {
  return {
    teamIds: row.placeTeamIds,
    spaceIds: row.placeSpaceIds,
    pageIds: row.placePageIds,
    orgLevel: row.placeOrgLevel,
  };
}
