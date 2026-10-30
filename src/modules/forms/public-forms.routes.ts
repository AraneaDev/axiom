import { Router } from 'express';

import { publicFormLimiter } from '../../middleware/rate-limit';

import * as publicFormsController from './public-forms.controller';

const router = Router();

// Public routes — no authentication required
router.get('/f/:formSlug', publicFormsController.getPublicForm);
router.post('/f/:formSlug/submit', publicFormLimiter, publicFormsController.submitForm);
router.post('/f/:formSlug/verify', publicFormLimiter, publicFormsController.verifyAccess);

export default router;
