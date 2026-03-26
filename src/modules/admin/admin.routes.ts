import { Router, Request, Response, NextFunction } from 'express';

import { authenticate } from '../../middleware/auth';
import { AppError } from '../../middleware/errorHandler';

import * as adminController from './admin.controller';
import { isUserAdmin } from './admin.service';

const router = Router();

// All admin routes require authentication
router.use(authenticate);

// Require the user to be a platform admin
async function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  try {
    const admin = await isUserAdmin(req.userId!);
    if (!admin) {
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
router.post('/users/:userId/deactivate', adminController.deactivateUser);
router.post('/users/:userId/reactivate', adminController.reactivateUser);
router.post('/users/:userId/reset-password', adminController.resetUserPassword);

// Settings
router.get('/settings', adminController.getSettings);

export default router;
