import { Request, Response, NextFunction } from 'express';

import { prisma } from '../config/database';
import { param } from '../utils/params';

import { AppError } from './errorHandler';

/**
 * Verifies the authenticated user is a member of the team that owns the project.
 * Expects `req.params.projectId` and `req.userId` (set by `authenticate`).
 * @param req
 * @param _res
 * @param next
 */
export async function requireProjectAccess(req: Request, _res: Response, next: NextFunction) {
  try {
    const projectId = param(req, 'projectId');

    // System admins bypass all project access checks
    const user = await prisma.user.findUnique({
      where: { id: req.userId! },
      select: { isAdmin: true },
    });
    if (user?.isAdmin) return next();

    const project = (await prisma.project.findUnique({
      where: { id: projectId },
      include: { team: { select: { id: true } } },
    })) as { teamId: string; team: { id: string } } | null;
    if (!project) return next(new AppError(404, 'Project not found'));

    const membership = await prisma.teamMembership.findUnique({
      where: { userId_teamId: { userId: req.userId!, teamId: project.team.id } },
    });
    if (!membership) return next(new AppError(403, 'Access denied', 'FORBIDDEN'));

    next();
  } catch (err) {
    next(err);
  }
}
