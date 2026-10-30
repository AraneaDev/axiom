import { Router } from 'express';

import { authenticate } from '../../middleware/auth';
import { requireProjectAccess, requireProjectWrite } from '../../middleware/requireProjectAccess';

import * as customFieldsCtrl from './custom-fields.controller';

const router = Router();

router.use(authenticate);
// Writes follow the permission matrix: VIEWERs and GUESTs can read, not change
router.use('/:projectId', requireProjectWrite());
// Project settings: team ADMINs, org OWNERs/ADMINs and platform admins only
router.use('/:projectId/custom-fields', requireProjectWrite('team:manage_members'));

// Project-scoped definition routes
router.use('/:projectId/custom-fields', requireProjectAccess);
router.post('/:projectId/custom-fields', customFieldsCtrl.createDefinition);
router.get('/:projectId/custom-fields', customFieldsCtrl.listDefinitions);

export default router;
