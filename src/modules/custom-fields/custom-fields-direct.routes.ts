import { Router } from 'express';

import { authenticate } from '../../middleware/auth';

import * as customFieldsCtrl from './custom-fields.controller';

const router = Router();

router.use(authenticate);

// Direct field definition routes (not project-scoped)
router.patch('/custom-fields/:fieldId', customFieldsCtrl.updateDefinition);
router.delete('/custom-fields/:fieldId', customFieldsCtrl.deleteDefinition);

// Issue custom field value routes
router.put('/issues/:issueId/custom-fields/:fieldId', customFieldsCtrl.setFieldValue);
router.get('/issues/:issueId/custom-fields', customFieldsCtrl.getFieldValues);

export default router;
