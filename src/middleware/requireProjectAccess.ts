import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database';
import { AppError } from './errorHandler';

/**
 * Verifies the authenticated user is a member of the team that owns the project.
 * Expects `req.params.projectId` and `req.userId` (set by `authenticate`).
 */
export async function requireProjectAccess(req: Request, _res: Response, next: NextFunction) {
  try {
    const { projectId } = req.params;
    if (!projectId) return next(new AppError(400, 'Project ID required'));

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { team: { select: { id: true } } },
    });
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
