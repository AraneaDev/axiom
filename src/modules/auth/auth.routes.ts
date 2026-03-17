import { Router } from 'express';
import * as authController from './auth.controller';
import { authenticate } from '../../middleware/auth';

const router = Router();

router.post('/register', authController.register);
router.post('/login', authController.login);
router.post('/refresh', authController.refreshToken);

// 2FA — requires authentication
router.post('/2fa/enable', authenticate, authController.enableTwoFactor);
router.post('/2fa/verify', authenticate, authController.verifyTwoFactor);
router.post('/2fa/disable', authenticate, authController.disableTwoFactor);

export default router;
