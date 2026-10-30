import { Router } from 'express';

import { publicFormLimiter } from '../../middleware/rate-limit';

import * as publicFormsController from './public-forms.controller';

const router = Router();

// Public routes — no authentication required
// A GET carrying a secret is a guess like verify: same per-IP limiter
router.get(
  '/f/:formSlug',
  (req, res, next) => (req.get('X-Form-Secret') ? publicFormLimiter(req, res, next) : next()),
  publicFormsController.getPublicForm,
);
router.post('/f/:formSlug/submit', publicFormLimiter, publicFormsController.submitForm);
router.post('/f/:formSlug/verify', publicFormLimiter, publicFormsController.verifyAccess);

export default router;
