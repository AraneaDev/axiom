import type { SpacePermissionLevel } from '@prisma/client';

import { prisma } from '../config/database';
import { AppError } from '../middleware/errorHandler';
import {
  assertOrgPermission,
  assertPageAccess,
  assertPageAccessBySlug,
  assertRestrictionAccess,
  assertTemplateAccess,
  checkOrgMember,
  checkTeamPermission,
  checkTeamRead,
  checkWikiSpaceOrgAccess,
} from '../middleware/rbac';
import { checkProjectAccess, checkProjectAction } from '../middleware/requireProjectAccess';
import { isUserAdmin } from '../modules/admin/admin.service';
import { canAccessSpace } from '../modules/wiki/space-permissions.service';
import { ERR } from '../utils/error-messages';
import type { Action } from '../utils/permissions';

import type { ActionContext } from './define';

/** An action's authorize function, for an action whose input is T. */
type Authorizer<T> = (ctx: ActionContext, input: T) => Promise<void>;

/**
 * Check the same thing as requireProjectAccess: a place on the project's team, or platform admin.
 * @param userId - The user
 * @param projectId - The project
 */
async function assertProjectRead(userId: string, projectId: string): Promise<void> {
  const access = await checkProjectAccess(userId, projectId);
  if (access === 'not_found') throw new AppError(404, ERR.PROJECT_NOT_FOUND);
  if (access === 'forbidden') throw new AppError(403, ERR.ACCESS_DENIED, 'FORBIDDEN');
}

/**
 * Read a project: requireProjectAccess.
 * @param pick - Finds the project id in the input
 */
export function projectRead<T>(pick: (input: T) => string): Authorizer<T> {
  return (ctx, input) => assertProjectRead(ctx.userId, pick(input));
}

/**
 * Check the user's role allows the action on a project, as requireProjectAction does.
 * @param userId - The user
 * @param projectId - The project
 * @param action - The permission action
 */
async function assertProjectRole(userId: string, projectId: string, action: Action): Promise<void> {
  const access = await checkProjectAction(userId, projectId, action);
  if (access === 'not_found') throw new AppError(404, ERR.PROJECT_NOT_FOUND);
  if (access === 'forbidden') {
    throw new AppError(403, `Insufficient permissions: ${action}`, 'FORBIDDEN');
  }
}

/**
 * Act on a project: the checks of requireProjectAccess and requireProjectWrite, with the same
 * status and code. Both are needed, because checkProjectAction accepts an org role alone and
 * REST turns away whoever is not on the team.
 *
 * Messages can differ from REST, status and code do not:
 * - Access comes first here, where REST routes run requireProjectWrite first. So someone off
 *   the team whose org role lacks the action reads "Access denied" instead of "Insufficient
 *   permissions".
 * - Settings routes stack requireProjectWrite() on requireProjectWrite('team:manage_members').
 *   A team VIEWER reads "Insufficient permissions: issue:edit" there over REST, and here the
 *   message names the action given, "Insufficient permissions: team:manage_members".
 * @param action - The permission action
 * @param pick - Finds the project id in the input
 */
export function projectAction<T>(action: Action, pick: (input: T) => string): Authorizer<T> {
  return async (ctx, input) => {
    const projectId = pick(input);
    await assertProjectRead(ctx.userId, projectId);
    await assertProjectRole(ctx.userId, projectId, action);
  };
}

/**
 * Reach a space: requireWikiSpaceAccess, then requireSpacePermission. Both are needed, because
 * canAccessSpace does not check the org on every path.
 * @param level - The minimum level on the space
 * @param pick - Finds the space id in the input
 */
export function spaceAccess<T>(
  level: SpacePermissionLevel,
  pick: (input: T) => string,
): Authorizer<T> {
  return async (ctx, input) => {
    const spaceId = pick(input);
    const access = await checkWikiSpaceOrgAccess(spaceId, ctx.userId);
    if (access === 'not_found') throw new AppError(404, 'Wiki space not found');
    if (access === 'forbidden') {
      throw new AppError(403, 'Not a member of this organization', 'NOT_ORG_MEMBER');
    }
    if (!(await canAccessSpace(spaceId, ctx.userId, level))) {
      throw new AppError(403, 'You do not have access to this space');
    }
  };
}

/**
 * Reach a page: assertPageAccess, which checks the org and the space before canViewPage or
 * canEditPage. Those two alone pass for anyone when the page has no restrictions.
 * @param mode - 'view' for reads, 'edit' for writes
 * @param pick - Finds the page id in the input
 */
export function pageAccess<T>(mode: 'view' | 'edit', pick: (input: T) => string): Authorizer<T> {
  return (ctx, input) => assertPageAccess(ctx.userId, pick(input), mode);
}

/**
 * Reach a page addressed by space and slug: the space checks, then the page's own restrictions.
 * A page that does not exist passes, so the handler answers 404 as the route did
 * (requireWikiPageBySlug).
 * @param level - The minimum level on the space
 * @param mode - 'view' for reads, 'edit' for writes
 * @param pickSpace - Finds the space id in the input
 * @param pickSlug - Finds the page slug in the input
 */
export function pageBySlugAccess<T>(
  level: SpacePermissionLevel,
  mode: 'view' | 'edit',
  pickSpace: (input: T) => string,
  pickSlug: (input: T) => string,
): Authorizer<T> {
  const space = spaceAccess(level, pickSpace);
  return async (ctx, input) => {
    await space(ctx, input);
    await assertPageAccessBySlug(ctx.userId, pickSpace(input), pickSlug(input), mode);
  };
}

/**
 * Act within a team: requireTeamPermission, with its status and code for each refusal.
 * @param action - The permission action
 * @param pick - Finds the team id in the input
 */
export function teamPermission<T>(action: Action, pick: (input: T) => string): Authorizer<T> {
  return async (ctx, input) => {
    const access = await checkTeamPermission(ctx.userId, pick(input), action);
    if (access === 'ok') return;
    if (access === 'not_found') throw new AppError(404, ERR.TEAM_NOT_FOUND);
    if (access === 'not_org_member') {
      throw new AppError(403, 'Not a member of this organization', 'NOT_ORG_MEMBER');
    }
    throw new AppError(403, `Insufficient permissions: ${action}`, 'FORBIDDEN');
  };
}

/**
 * Team-wide reads: requireTeamMember.
 * @param pick - Finds the team id in the input
 */
export function teamRead<T>(pick: (input: T) => string): Authorizer<T> {
  return async (ctx, input) => {
    const access = await checkTeamRead(ctx.userId, pick(input));
    if (access === 'not_found') throw new AppError(404, ERR.TEAM_NOT_FOUND);
    if (access === 'forbidden') throw new AppError(403, 'You are not a member of this team');
  };
}

/**
 * A record addressed through a project: requireProjectAccess, the role check when `action` is
 * given, then requireOwnedByProject. A record of another project answers 404, as if it did not
 * exist in this one. Writes pass `action`; see projectAction for the messages that differ from
 * REST.
 * @param resolver - Returns the projects the record belongs to; see `projectOf`
 * @param pick - Finds the project id and the record id in the input
 * @param action - The permission action, for writes
 */
export function ownedByProject<T>(
  resolver: (id: string) => Promise<Array<string | null | undefined>>,
  pick: (input: T) => { projectId: string; recordId: string },
  action?: Action,
): Authorizer<T> {
  return async (ctx, input) => {
    const { projectId, recordId } = pick(input);
    await assertProjectRead(ctx.userId, projectId);
    if (action) await assertProjectRole(ctx.userId, projectId, action);
    const owners = await resolver(recordId);
    if (!owners.includes(projectId)) throw new AppError(404, 'Not found in this project');
  };
}

/**
 * Org-wide reads: requireOrgMember.
 * @param pick - Finds the org id in the input
 */
export function orgMember<T>(pick: (input: T) => string): Authorizer<T> {
  return async (ctx, input) => {
    if (!(await checkOrgMember(ctx.userId, pick(input)))) {
      throw new AppError(403, 'Not a member of this organization', 'NOT_ORG_MEMBER');
    }
  };
}

/**
 * Act on an org: requireOrgPermission.
 * @param action - The permission action
 * @param pick - Finds the org id in the input
 */
export function orgPermission<T>(action: Action, pick: (input: T) => string): Authorizer<T> {
  return (ctx, input) => assertOrgPermission(ctx.userId, pick(input), action);
}

/**
 * Create in a team: requireTeamMember, then requireTeamPermission. Both are needed, because the
 * permission alone passes on an org role and a team read turns away whoever is off the team.
 * @param action - The permission action
 * @param pick - Finds the team id in the input
 */
export function teamMemberWith<T>(action: Action, pick: (input: T) => string): Authorizer<T> {
  const read = teamRead(pick);
  const role = teamPermission(action, pick);
  return async (ctx, input) => {
    await read(ctx, input);
    await role(ctx, input);
  };
}

/**
 * Anything under /api/admin: requireAdmin.
 * @param ctx - Who runs the action
 */
export async function platformAdmin(ctx: ActionContext): Promise<void> {
  if (!(await isUserAdmin(ctx.userId))) {
    throw new AppError(403, 'Admin access required', 'FORBIDDEN');
  }
}

/**
 * Remove a page restriction by its own id: edit access to its page.
 * @param pick - Finds the restriction id in the input
 */
export function restrictionAccess<T>(pick: (input: T) => string): Authorizer<T> {
  return (ctx, input) => assertRestrictionAccess(ctx.userId, pick(input));
}

/**
 * Reach a wiki page comment: view access to the page it is on (requireWikiCommentAccess).
 * @param pick - Finds the comment id in the input
 */
export function pageCommentAccess<T>(pick: (input: T) => string): Authorizer<T> {
  return async (ctx, input) => {
    const comment = await prisma.pageComment.findUnique({
      where: { id: pick(input) },
      select: { pageId: true },
    });
    if (!comment) throw new AppError(404, ERR.COMMENT_NOT_FOUND);
    await assertPageAccess(ctx.userId, comment.pageId, 'view');
  };
}

/**
 * Reach a page template: the org and the space permission at the given level.
 * @param level - The minimum level on its space
 * @param pick - Finds the template id in the input
 */
export function templateAccess<T>(
  level: SpacePermissionLevel,
  pick: (input: T) => string,
): Authorizer<T> {
  return (ctx, input) => assertTemplateAccess(ctx.userId, pick(input), level);
}
