import { Router } from 'express';

import { authenticate } from '../../middleware/auth';
import { requireProjectAccess } from '../../middleware/requireProjectAccess';

import * as customFieldsCtrl from './custom-fields.controller';

const router = Router();

router.use(authenticate);

// Project-scoped definition routes
router.use('/:projectId/custom-fields', requireProjectAccess);
router.post('/:projectId/custom-fields', customFieldsCtrl.createDefinition);
router.get('/:projectId/custom-fields', customFieldsCtrl.listDefinitions);

export default router;
