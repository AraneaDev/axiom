import { Router } from 'express';

import { authenticate } from '../../middleware/auth';
import { requireAdmin } from '../../middleware/requireAdmin';

import * as auditController from './audit.controller';

const router = Router();

router.use(authenticate);
// Audit logs span every org: platform admins only
router.use(requireAdmin);

router.get('/', auditController.list);
router.get('/:id', auditController.get);

export default router;
