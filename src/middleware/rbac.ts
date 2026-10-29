import { Request, Response, NextFunction } from 'express';

import { prisma } from '../config/database';
import { ERR } from '../utils/error-messages';
import { param } from '../utils/params';
import { Action, hasPermission, hasOrgPermission } from '../utils/permissions';

import { AppError } from './errorHandler';

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

      const space = await prisma.wikiSpace.findUnique({
        where: { id: spaceId },
        select: { team: { select: { orgId: true } } },
      });
      if (!space) throw new AppError(404, 'Wiki space not found');

      const orgMembership = await prisma.orgMembership.findUnique({
        where: { userId_orgId: { userId, orgId: space.team.orgId } },
      });
      if (!orgMembership) {
        throw new AppError(403, 'Not a member of this organization', 'NOT_ORG_MEMBER');
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Verify the authenticated user is a member of the org that owns the wiki page.
 * Expects :pageId in route params.
 * @returns Express middleware that checks org membership for the page's org
 * @throws {AppError} 401 if not authenticated
 * @throws {AppError} 404 if wiki page not found
 * @throws {AppError} 403 if user is not an org member
 */
export function requireWikiPageAccess() {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const pageId = param(req, 'pageId');
      const userId = req.userId;
      if (!userId) throw new AppError(401, 'Authentication required');

      const page = await prisma.page.findUnique({
        where: { id: pageId },
        select: { space: { select: { team: { select: { orgId: true } } } } },
      });
      if (!page) throw new AppError(404, 'Wiki page not found');

      const orgMembership = await prisma.orgMembership.findUnique({
        where: { userId_orgId: { userId, orgId: page.space.team.orgId } },
      });
      if (!orgMembership) {
        throw new AppError(403, 'Not a member of this organization', 'NOT_ORG_MEMBER');
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Verify the authenticated user is a member of the org that owns the wiki comment.
 * Expects :commentId in route params.
 * @returns Express middleware that checks org membership for the comment's org
 * @throws {AppError} 401 if not authenticated
 * @throws {AppError} 404 if comment not found
 * @throws {AppError} 403 if user is not an org member
 */
export function requireWikiCommentAccess() {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const commentId = param(req, 'commentId');
      const userId = req.userId;
      if (!userId) throw new AppError(401, 'Authentication required');

      const comment = await prisma.pageComment.findUnique({
        where: { id: commentId },
        select: { page: { select: { space: { select: { team: { select: { orgId: true } } } } } } },
      });
      if (!comment) throw new AppError(404, ERR.COMMENT_NOT_FOUND);

      const orgMembership = await prisma.orgMembership.findUnique({
        where: { userId_orgId: { userId, orgId: comment.page.space.team.orgId } },
      });
      if (!orgMembership) {
        throw new AppError(403, 'Not a member of this organization', 'NOT_ORG_MEMBER');
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Verify the authenticated user is a member of the org that owns the wiki template.
 * Expects :templateId in route params.
 * @returns Express middleware that checks org membership for the template's org
 * @throws {AppError} 401 if not authenticated
 * @throws {AppError} 404 if template not found
 * @throws {AppError} 403 if user is not an org member
 */
export function requireWikiTemplateAccess() {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const templateId = param(req, 'templateId');
      const userId = req.userId;
      if (!userId) throw new AppError(401, 'Authentication required');

      const template = await prisma.pageTemplate.findUnique({
        where: { id: templateId },
        select: { space: { select: { team: { select: { orgId: true } } } } },
      });
      if (!template) throw new AppError(404, ERR.TEMPLATE_NOT_FOUND);

      const orgMembership = await prisma.orgMembership.findUnique({
        where: { userId_orgId: { userId, orgId: template.space.team.orgId } },
      });
      if (!orgMembership) {
        throw new AppError(403, 'Not a member of this organization', 'NOT_ORG_MEMBER');
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Verify the authenticated user is a member of the org that owns the wiki restriction.
 * Expects :restrictionId in route params.
 * @returns Express middleware that checks org membership for the restriction's org
 * @throws {AppError} 401 if not authenticated
 * @throws {AppError} 404 if restriction not found
 * @throws {AppError} 403 if user is not an org member
 */
export function requireWikiRestrictionAccess() {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const restrictionId = param(req, 'restrictionId');
      const userId = req.userId;
      if (!userId) throw new AppError(401, 'Authentication required');

      const restriction = await prisma.pageRestriction.findUnique({
        where: { id: restrictionId },
        select: { page: { select: { space: { select: { team: { select: { orgId: true } } } } } } },
      });
      if (!restriction) throw new AppError(404, ERR.RESTRICTION_NOT_FOUND);

      const orgMembership = await prisma.orgMembership.findUnique({
        where: { userId_orgId: { userId, orgId: restriction.page.space.team.orgId } },
      });
      if (!orgMembership) {
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

      // Get team to find org
      const team = await prisma.team.findUnique({ where: { id: teamId } });
      if (!team) throw new AppError(404, ERR.TEAM_NOT_FOUND);

      // Check org membership first
      const orgMembership = await prisma.orgMembership.findUnique({
        where: { userId_orgId: { userId, orgId: team.orgId } },
      });
      if (!orgMembership) {
        throw new AppError(403, 'Not a member of this organization', 'NOT_ORG_MEMBER');
      }

      // Check team membership
      const teamMembership = await prisma.teamMembership.findUnique({
        where: { userId_teamId: { userId, teamId } },
      });

      if (hasPermission(orgMembership.role, teamMembership?.role ?? null, action)) {
        return next();
      }

      throw new AppError(403, `Insufficient permissions: ${action}`, 'FORBIDDEN');
    } catch (err) {
      next(err);
    }
  };
}
