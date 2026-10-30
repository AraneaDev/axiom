import { Router } from 'express';

import { authenticate } from '../../middleware/auth';
import { requireAdmin } from '../../middleware/requireAdmin';

import * as adminController from './admin.controller';

const router = Router();

// All admin routes require authentication
router.use(authenticate);

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
