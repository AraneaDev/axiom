import { Request, Response, NextFunction } from 'express';

import { prisma } from '../config/database';
import { param } from '../utils/params';
import { Action, hasPermission, hasOrgPermission } from '../utils/permissions';

import { AppError } from './errorHandler';

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
