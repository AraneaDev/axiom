import { Router } from 'express';

import { authenticate } from '../../middleware/auth';
import {
  projectOf,
  requireProjectAccess,
  requireOwnedByProject,
} from '../../middleware/requireProjectAccess';

import * as automationController from './automation.controller';

const router = Router();

router.use(authenticate);
router.use('/:projectId/automation-rules', requireProjectAccess);
router.use(
  '/:projectId/automation-rules/:ruleId',
  requireOwnedByProject('ruleId', projectOf.automationRule),
);

router.post('/:projectId/automation-rules', automationController.create);
router.get('/:projectId/automation-rules', automationController.list);
router.patch('/:projectId/automation-rules/:ruleId', automationController.update);
router.delete('/:projectId/automation-rules/:ruleId', automationController.remove);
router.post('/:projectId/automation-rules/:ruleId/toggle', automationController.toggle);

export default router;
