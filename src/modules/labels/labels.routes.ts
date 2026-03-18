import { Router } from 'express';

import { authenticate } from '../../middleware/auth';
import { requireProjectAccess } from '../../middleware/requireProjectAccess';

import * as labelsController from './labels.controller';

const router = Router();

router.use(authenticate);
router.use('/:projectId/labels', requireProjectAccess);

router.post('/:projectId/labels', labelsController.create);
router.get('/:projectId/labels', labelsController.list);
router.patch('/:projectId/labels/:labelName', labelsController.update);
router.delete('/:projectId/labels/:labelName', labelsController.remove);

export default router;
