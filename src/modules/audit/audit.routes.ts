import { Router } from 'express';

import { authenticate } from '../../middleware/auth';

import * as auditController from './audit.controller';

const router = Router();

router.use(authenticate);

router.get('/', auditController.list);
router.get('/:id', auditController.get);

export default router;
