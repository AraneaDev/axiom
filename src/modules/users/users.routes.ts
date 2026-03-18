import { Router } from 'express';

import { authenticate } from '../../middleware/auth';

import * as usersController from './users.controller';

const router = Router();

router.use(authenticate);

// Profile
router.get('/me', usersController.getMe);
router.patch('/me', usersController.updateMe);

// SSH Keys
router.get('/me/ssh-keys', usersController.listSshKeys);
router.post('/me/ssh-keys', usersController.addSshKey);
router.delete('/me/ssh-keys/:keyId', usersController.deleteSshKey);

// API Tokens
router.get('/me/tokens', usersController.listApiTokens);
router.post('/me/tokens', usersController.createApiToken);
router.delete('/me/tokens/:tokenId', usersController.deleteApiToken);

export default router;
