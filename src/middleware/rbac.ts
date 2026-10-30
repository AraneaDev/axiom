import type { SpacePermissionLevel } from '@prisma/client';
import { Request, Response, NextFunction } from 'express';

import { prisma } from '../config/database';
import { canAccessSpace } from '../modules/wiki/space-permissions.service';
import { canEditPage, canViewPage } from '../modules/wiki/wiki-permissions.service';
import { ERR } from '../utils/error-messages';
import { param } from '../utils/params';
import { Action, hasPermission, hasOrgPermission } from '../utils/permissions';

import { AppError } from './errorHandler';

/**
 * Check that a user is a member of the org that owns a wiki space. This is the first of
 * the two checks the space routes make; space permissions (`canAccessSpace`) come second.
 * @param spaceId - The space to check
 * @param userId - The user to check
 * @returns 'ok', 'not_found' when the space doesn't exist, or 'forbidden'
 */
export async function checkWikiSpaceOrgAccess(
  spaceId: string,
  userId: string,
): Promise<'ok' | 'not_found' | 'forbidden'> {
  const space = await prisma.wikiSpace.findUnique({
    where: { id: spaceId },
    select: { team: { select: { orgId: true } } },
  });
  if (!space) return 'not_found';

  const orgMembership = await prisma.orgMembership.findUnique({
    where: { userId_orgId: { userId, orgId: space.team.orgId } },
  });
  return orgMembership ? 'ok' : 'forbidden';
}

/**
 * Verify the authenticated user is a member of the org that owns the wiki space.
 * Expects :spaceId in route params.
 * @returns Express middleware that checks org membership for the space's org
 * @throws {AppError} 401 if not authenticated
 * @throws {AppError} 404 if wiki space not found
 * @throws {AppError} 403 if user is not an org member
 */
export function requireWikiSpaceAccess() {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const spaceId = param(req, 'spaceId');
      const userId = req.userId;
      if (!userId) throw new AppError(401, 'Authentication required');

      const access = await checkWikiSpaceOrgAccess(spaceId, userId);
      if (access === 'not_found') throw new AppError(404, 'Wiki space not found');
      if (access === 'forbidden') {
        throw new AppError(403, 'Not a member of this organization', 'NOT_ORG_MEMBER');
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * The checks every page route needs, in REST order: the page exists, the user is in its
 * org, their space permission reaches the level, and the page's own restrictions let them
 * view (or edit) it. canAccessSpace and canViewPage pass for anyone when nothing is
 * restricted, so the org check must come first.
 * @param userId - The user
 * @param pageId - The page
 * @param mode - 'view' for reads, 'edit' for writes
 * @throws {AppError} 404 when the page doesn't exist, 403 otherwise
 */
export async function assertPageAccess(
  userId: string,
  pageId: string,
  mode: 'view' | 'edit',
): Promise<void> {
  const page = await prisma.page.findUnique({ where: { id: pageId }, select: { spaceId: true } });
  if (!page) throw new AppError(404, 'Wiki page not found');
  const orgAccess = await checkWikiSpaceOrgAccess(page.spaceId, userId);
  if (orgAccess !== 'ok') {
    throw new AppError(403, 'Not a member of this organization', 'NOT_ORG_MEMBER');
  }
  if (!(await canAccessSpace(page.spaceId, userId, mode === 'edit' ? 'EDIT' : 'VIEW'))) {
    throw new AppError(403, 'You do not have access to this space');
  }
  const allowed =
    mode === 'edit' ? await canEditPage(userId, pageId) : await canViewPage(userId, pageId);
  if (!allowed) throw new AppError(403, 'You do not have access to this page');
}

/**
 * Page routes addressed by id. Expects :pageId in route params.
 * @param mode - 'view' (default) for reads, 'edit' for writes
 * @returns Express middleware running assertPageAccess
 */
export function requireWikiPageAccess(mode: 'view' | 'edit' = 'view') {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const userId = req.userId;
      if (!userId) throw new AppError(401, 'Authentication required');
      await assertPageAccess(userId, param(req, 'pageId'), mode);
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Page routes addressed by space and slug, after the space checks. Expects :spaceId and
 * :pageSlug. A missing page passes through so the handler answers 404 as before.
 * @param mode - 'view' for reads, 'edit' for writes
 * @returns Express middleware checking the page's own restrictions
 */
export function requireWikiPageBySlug(mode: 'view' | 'edit') {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const userId = req.userId;
      if (!userId) throw new AppError(401, 'Authentication required');
      const page = await prisma.page.findUnique({
        where: { spaceId_slug: { spaceId: param(req, 'spaceId'), slug: param(req, 'pageSlug') } },
        select: { id: true },
      });
      if (!page) return next();
      await assertPageAccess(userId, page.id, mode);
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Comment routes: the user needs view access to the comment's page. Expects :commentId.
 * @returns Express middleware
 */
export function requireWikiCommentAccess() {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const userId = req.userId;
      if (!userId) throw new AppError(401, 'Authentication required');
      const comment = await prisma.pageComment.findUnique({
        where: { id: param(req, 'commentId') },
        select: { pageId: true },
      });
      if (!comment) throw new AppError(404, ERR.COMMENT_NOT_FOUND);
      await assertPageAccess(userId, comment.pageId, 'view');
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Template routes: org membership and the space permission at the given level.
 * Expects :templateId.
 * @param level - VIEW (default) for reads, EDIT for changes
 * @returns Express middleware
 */
export function requireWikiTemplateAccess(level: SpacePermissionLevel = 'VIEW') {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const userId = req.userId;
      if (!userId) throw new AppError(401, 'Authentication required');
      const template = await prisma.pageTemplate.findUnique({
        where: { id: param(req, 'templateId') },
        select: { spaceId: true },
      });
      if (!template) throw new AppError(404, ERR.TEMPLATE_NOT_FOUND);
      if ((await checkWikiSpaceOrgAccess(template.spaceId, userId)) !== 'ok') {
        throw new AppError(403, 'Not a member of this organization', 'NOT_ORG_MEMBER');
      }
      if (!(await canAccessSpace(template.spaceId, userId, level))) {
        throw new AppError(403, 'You do not have access to this space');
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Removing a page restriction needs edit access to the page, as setting them does.
 * Expects :restrictionId.
 * @returns Express middleware
 */
export function requireWikiRestrictionAccess() {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const userId = req.userId;
      if (!userId) throw new AppError(401, 'Authentication required');
      const restriction = await prisma.pageRestriction.findUnique({
        where: { id: param(req, 'restrictionId') },
        select: { pageId: true },
      });
      if (!restriction) throw new AppError(404, ERR.RESTRICTION_NOT_FOUND);
      await assertPageAccess(userId, restriction.pageId, 'edit');
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Require membership of the org in :orgId, in any role. For reads that every member may
 * make, such as listing the org's teams.
 * @returns Express middleware
 */
export function requireOrgMember() {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const userId = req.userId;
      if (!userId) throw new AppError(401, 'Authentication required');
      const [user, membership] = await Promise.all([
        prisma.user.findUnique({ where: { id: userId }, select: { isAdmin: true } }),
        prisma.orgMembership.findUnique({
          where: { userId_orgId: { userId, orgId: param(req, 'orgId') } },
        }),
      ]);
      if (!membership && !user?.isAdmin) {
        throw new AppError(403, 'Not a member of this organization', 'NOT_ORG_MEMBER');
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Require org-level permission. Expects :orgId in route params.
 * @param action - The permission action to check (e.g., 'manage_members', 'delete')
 * @returns Express middleware that checks org-level permissions
 * @throws {AppError} 401 if not authenticated
 * @throws {AppError} 403 if user lacks the required org permission
 */
export function requireOrgPermission(action: Action) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const orgId = param(req, 'orgId');
      const userId = req.userId;
      if (!userId) throw new AppError(401, 'Authentication required');

      // Platform admins keep full rights, so they can manage any org (transfer ownership)
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { isAdmin: true },
      });
      if (user?.isAdmin) return next();

      const membership = await prisma.orgMembership.findUnique({
        where: { userId_orgId: { userId, orgId } },
      });

      if (!membership) {
        throw new AppError(403, 'Not a member of this organization', 'NOT_ORG_MEMBER');
      }

      if (!hasOrgPermission(membership.role, action)) {
        throw new AppError(403, `Insufficient permissions: ${action}`, 'FORBIDDEN');
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Check a team-scoped permission: the user must be in the team's org, and the action must
 * be allowed by their org role or by their role in this team (not some other team).
 * @param userId - The user to check
 * @param teamId - The team that owns the resource
 * @param action - The permission action to check
 * @returns 'ok', 'not_found', 'not_org_member' or 'forbidden'
 */
export async function checkTeamPermission(
  userId: string,
  teamId: string,
  action: Action,
): Promise<'ok' | 'not_found' | 'not_org_member' | 'forbidden'> {
  const team = await prisma.team.findUnique({ where: { id: teamId }, select: { orgId: true } });
  if (!team) return 'not_found';

  // Platform admins keep full rights, as in checkProjectAction and canAccessSpace
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { isAdmin: true } });
  if (user?.isAdmin) return 'ok';

  const orgMembership = await prisma.orgMembership.findUnique({
    where: { userId_orgId: { userId, orgId: team.orgId } },
  });
  if (!orgMembership) return 'not_org_member';

  const teamMembership = await prisma.teamMembership.findUnique({
    where: { userId_teamId: { userId, teamId } },
  });
  return hasPermission(orgMembership.role, teamMembership?.role ?? null, action)
    ? 'ok'
    : 'forbidden';
}

/**
 * Team-wide reads (the team, its members, activity, roadmap, analytics, project list):
 * team members, org OWNERs and ADMINs, and platform admins. The same rule as
 * checkProjectAccess, so a team's overview never shows more than its projects would.
 * @param userId - The reader
 * @param teamId - The team
 * @returns 'ok', 'not_found' or 'forbidden'
 */
export async function checkTeamRead(
  userId: string,
  teamId: string,
): Promise<'ok' | 'not_found' | 'forbidden'> {
  const team = await prisma.team.findUnique({ where: { id: teamId }, select: { orgId: true } });
  if (!team) return 'not_found';
  const [user, orgMembership, teamMembership] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { isAdmin: true } }),
    prisma.orgMembership.findUnique({ where: { userId_orgId: { userId, orgId: team.orgId } } }),
    prisma.teamMembership.findUnique({ where: { userId_teamId: { userId, teamId } } }),
  ]);
  if (user?.isAdmin || teamMembership) return 'ok';
  if (orgMembership?.role === 'OWNER' || orgMembership?.role === 'ADMIN') return 'ok';
  return 'forbidden';
}

/**
 * Require checkTeamRead for :teamId.
 * @returns Express middleware
 */
export function requireTeamMember() {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const userId = req.userId;
      if (!userId) throw new AppError(401, 'Authentication required');
      const access = await checkTeamRead(userId, param(req, 'teamId'));
      if (access === 'not_found') throw new AppError(404, ERR.TEAM_NOT_FOUND);
      if (access === 'forbidden') throw new AppError(403, 'You are not a member of this team');
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Require team-level permission. Expects :teamId in route params.
 * Also checks org-level permissions as a fallback (org admins/owners bypass team checks).
 * @param action - The permission action to check
 * @returns Express middleware that checks team-level permissions with org fallback
 * @throws {AppError} 401 if not authenticated
 * @throws {AppError} 404 if team not found
 * @throws {AppError} 403 if user lacks the required permission at both team and org level
 */
export function requireTeamPermission(action: Action) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const teamId = param(req, 'teamId');
      const userId = req.userId;
      if (!userId) throw new AppError(401, 'Authentication required');

      const access = await checkTeamPermission(userId, teamId, action);
      if (access === 'not_found') throw new AppError(404, ERR.TEAM_NOT_FOUND);
      if (access === 'not_org_member') {
        throw new AppError(403, 'Not a member of this organization', 'NOT_ORG_MEMBER');
      }
      if (access === 'ok') return next();

      throw new AppError(403, `Insufficient permissions: ${action}`, 'FORBIDDEN');
    } catch (err) {
      next(err);
    }
  };
}
