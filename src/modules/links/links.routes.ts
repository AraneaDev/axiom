import { Router } from 'express';

import { authenticate } from '../../middleware/auth';

import { resolveLinkHandler } from './resolve-link.controller';

const router = Router();

router.use(authenticate);
router.get('/resolve-link', resolveLinkHandler);

export default router;
