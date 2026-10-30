import { Request, Response, NextFunction } from 'express';

import { isUserAdmin } from '../modules/admin/admin.service';

import { AppError } from './errorHandler';

/**
 * Require a platform admin. Each admin-only router applies it itself, so its protection
 * doesn't depend on where it is mounted.
 * @param req
 * @param _res
 * @param next
 */
export async function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  try {
    if (!req.userId || !(await isUserAdmin(req.userId))) {
      return next(new AppError(403, 'Admin access required', 'FORBIDDEN'));
    }
    next();
  } catch (err) {
    next(err);
  }
}
