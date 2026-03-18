import { Router } from 'express';

import { authenticate } from '../../middleware/auth';

import * as authController from './auth.controller';

const router = Router();

router.post('/register', authController.register);
router.post('/login', authController.login);
router.post('/refresh', authController.refreshToken);
router.post('/logout', authenticate, authController.logout);

// 2FA — requires authentication
router.post('/2fa/enable', authenticate, authController.enableTwoFactor);
router.post('/2fa/verify', authenticate, authController.verifyTwoFactor);
router.post('/2fa/disable', authenticate, authController.disableTwoFactor);

export default router;
