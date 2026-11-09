import { SpacePermissionLevel } from '@prisma/client';
import { Request, Response, NextFunction } from 'express';

import { AppError } from '../../middleware/errorHandler';
import { param } from '../../utils/params';

import { canAccessSpace } from './space-access';

/**
 * Middleware that checks whether the authenticated user has the required
 * permission level on a wiki space. Expects :spaceId in route params.
 * @param level - The minimum permission level required (VIEW, EDIT, or ADMIN)
 * @returns Express middleware
 */
export function requireSpacePermission(level: SpacePermissionLevel) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const spaceId = param(req, 'spaceId');
      const userId = req.userId;
      if (!userId) throw new AppError(401, 'Authentication required');

      const allowed = await canAccessSpace(spaceId, userId, level);
      if (!allowed) {
        return res.status(403).json({ error: { message: 'You do not have access to this space' } });
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}
