import { Router } from 'express';

import { authenticate } from '../../middleware/auth';

import * as usersController from './users.controller';

const router = Router();

router.use(authenticate);

// User search
router.get('/search', usersController.searchUsersHandler);

// Profile
router.get('/me', usersController.getMe);
router.patch('/me', usersController.updateMe);

// Dashboard
router.get('/me/dashboard', usersController.getDashboard);

// API Tokens: creating and revoking run through the registry
router.get('/me/tokens', usersController.listApiTokens);

export default router;
