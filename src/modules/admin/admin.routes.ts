import { Router, Request, Response, NextFunction } from 'express';

import { prisma } from '../../config/database';
import { authenticate } from '../../middleware/auth';
import { AppError } from '../../middleware/errorHandler';

import * as adminController from './admin.controller';

const router = Router();

// All admin routes require authentication
router.use(authenticate);

// Require the user to be an org OWNER
async function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  try {
    const membership = await prisma.orgMembership.findFirst({
      where: { userId: req.userId!, role: 'OWNER' },
    });
    if (!membership) {
      return next(new AppError(403, 'Admin access required', 'FORBIDDEN'));
    }
    next();
  } catch (err) {
    next(err);
  }
}

router.use(requireAdmin);

// Stats
router.get('/stats', adminController.getStats);

// Users
router.get('/users', adminController.listUsers);
router.get('/users/:userId', adminController.getUser);
router.patch('/users/:userId', adminController.updateUser);
router.delete('/users/:userId', adminController.deleteUser);

// Settings
router.get('/settings', adminController.getSettings);

export default router;
