import { Router } from 'express';

import { authenticate } from '../../middleware/auth';
import {
  projectOf,
  requireProjectAccess,
  requireOwnedByProject,
  requireProjectWrite,
} from '../../middleware/requireProjectAccess';

import * as workflowController from './workflows.controller';

const router = Router();

router.use(authenticate);
// Writes follow the permission matrix: VIEWERs and GUESTs can read, not change
router.use('/:projectId', requireProjectWrite());

router.use('/:projectId/workflow-rules', requireProjectAccess);
router.use(
  '/:projectId/workflow-rules/:ruleId',
  requireOwnedByProject('ruleId', projectOf.workflowRule),
);

router.post('/:projectId/workflow-rules', workflowController.create);
router.get('/:projectId/workflow-rules', workflowController.list);
router.patch('/:projectId/workflow-rules/:ruleId', workflowController.update);
router.delete('/:projectId/workflow-rules/:ruleId', workflowController.remove);

export default router;
