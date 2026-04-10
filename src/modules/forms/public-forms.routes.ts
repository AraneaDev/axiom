import { Router } from 'express';

import * as publicFormsController from './public-forms.controller';

const router = Router();

// Public routes — no authentication required
router.get('/f/:formSlug', publicFormsController.getPublicForm);
router.post('/f/:formSlug/submit', publicFormsController.submitForm);
router.post('/f/:formSlug/verify', publicFormsController.verifyAccess);

export default router;
