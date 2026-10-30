import { Request, Response } from 'express';

import { AppError } from '../../middleware/errorHandler';
import { checkWikiSpaceOrgAccess } from '../../middleware/rbac';
import { checkProjectAccess } from '../../middleware/requireProjectAccess';
import { asyncHandler } from '../../utils/asyncHandler';
import { ERR } from '../../utils/error-messages';

import { canAccessSpace } from './space-permissions.service';
import { resolveWikiTemplate } from './wiki-template-resolver.service';

export const resolveTemplate = asyncHandler(async (req: Request, res: Response) => {
  const { body, context } = req.body as {
    body?: unknown;
    context?: { spaceId?: unknown; teamId?: unknown; projectId?: unknown };
  };
  const spaceId = context?.spaceId;
  const projectId = context?.projectId;
  if (typeof body !== 'string' || typeof spaceId !== 'string') {
    throw new AppError(400, 'body and context.spaceId are required');
  }
  if (projectId !== undefined && typeof projectId !== 'string') {
    throw new AppError(400, 'context.projectId must be a string');
  }
  const userId = req.userId!;

  // The template reads the space's (and project's) names: the user must be able to open them
  const spaceAccess = await checkWikiSpaceOrgAccess(spaceId, userId);
  if (spaceAccess === 'not_found') throw new AppError(404, ERR.SPACE_NOT_FOUND);
  if (spaceAccess === 'forbidden' || !(await canAccessSpace(spaceId, userId, 'VIEW'))) {
    throw new AppError(403, 'You do not have access to this space');
  }
  if (projectId) {
    const projectAccess = await checkProjectAccess(userId, projectId);
    if (projectAccess === 'not_found') throw new AppError(404, ERR.PROJECT_NOT_FOUND);
    if (projectAccess === 'forbidden') throw new AppError(403, ERR.ACCESS_DENIED, 'FORBIDDEN');
  }

  const resolved = await resolveWikiTemplate(body, {
    teamId: typeof context?.teamId === 'string' ? context.teamId : '',
    spaceId,
    projectId,
    userId,
  });
  res.json({ body: resolved });
});
