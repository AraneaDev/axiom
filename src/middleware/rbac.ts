import { Request, Response, NextFunction } from 'express';

import { prisma } from '../config/database';
import { param } from '../utils/params';
import { Action, hasPermission, hasOrgPermission } from '../utils/permissions';

import { AppError } from './errorHandler';

/**
 * Verify the authenticated user is a member of the org that owns the repo.
 * Expects :repoId in route params.
 */
export function requireRepoAccess() {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const repoId = param(req, 'repoId');
      const userId = req.userId;
      if (!userId) throw new AppError(401, 'Authentication required');

      const repo = await prisma.repository.findUnique({
        where: { id: repoId },
        select: { team: { select: { orgId: true } } },
      });
      if (!repo) throw new AppError(404, 'Repository not found');

      const orgMembership = await prisma.orgMembership.findUnique({
        where: { userId_orgId: { userId, orgId: repo.team.orgId } },
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
 * Verify the authenticated user is a member of the org that owns the wiki space.
 * Expects :spaceId in route params.
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
      if (!comment) throw new AppError(404, 'Comment not found');

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
      if (!template) throw new AppError(404, 'Template not found');

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
 * Require org-level permission. Expects :orgId in route params.
 * @param action
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
 * @param action
 */
export function requireTeamPermission(action: Action) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const teamId = param(req, 'teamId');
      const userId = req.userId;
      if (!userId) throw new AppError(401, 'Authentication required');

      // Get team to find org
      const team = await prisma.team.findUnique({ where: { id: teamId } });
      if (!team) throw new AppError(404, 'Team not found');

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
