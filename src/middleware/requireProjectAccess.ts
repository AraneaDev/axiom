import { Request, Response, NextFunction } from 'express';

import { prisma } from '../config/database';
import { ERR } from '../utils/error-messages';
import { param } from '../utils/params';

import { AppError } from './errorHandler';

export type ProjectAccess = 'ok' | 'not_found' | 'forbidden';

/**
 * Decide whether a user can view a project: system admins always can, everyone else
 * needs a membership in the team that owns it. Shared by the REST middleware below and
 * the realtime room checks.
 * @param userId - The user to check
 * @param projectId - The project to check
 * @returns 'ok', 'not_found' when the project doesn't exist, or 'forbidden'
 */
export async function checkProjectAccess(
  userId: string,
  projectId: string,
): Promise<ProjectAccess> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { teamId: true },
  });
  if (!project) return 'not_found';

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { isAdmin: true } });
  if (user?.isAdmin) return 'ok';

  const membership = await prisma.teamMembership.findUnique({
    where: { userId_teamId: { userId, teamId: project.teamId } },
  });
  return membership ? 'ok' : 'forbidden';
}

/**
 * Verifies the authenticated user is a member of the team that owns the project.
 * Expects `req.params.projectId` and `req.userId` (set by `authenticate`).
 * @param req
 * @param _res
 * @param next
 */
export async function requireProjectAccess(req: Request, _res: Response, next: NextFunction) {
  try {
    const access = await checkProjectAccess(req.userId!, param(req, 'projectId'));
    if (access === 'not_found') return next(new AppError(404, ERR.PROJECT_NOT_FOUND));
    if (access === 'forbidden') return next(new AppError(403, ERR.ACCESS_DENIED, 'FORBIDDEN'));
    next();
  } catch (err) {
    next(err);
  }
}
