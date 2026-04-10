import { Router } from 'express';

import { authenticate } from '../../middleware/auth';
import { requireProjectAccess } from '../../middleware/requireProjectAccess';

import * as intakeController from './intake.controller';

const router = Router();
router.use(authenticate);

router.get('/:projectId/intake', requireProjectAccess, intakeController.list);
router.get('/:projectId/intake/:submissionId', requireProjectAccess, intakeController.get);
router.post(
  '/:projectId/intake/:submissionId/approve',
  requireProjectAccess,
  intakeController.approve,
);
router.post(
  '/:projectId/intake/:submissionId/reject',
  requireProjectAccess,
  intakeController.reject,
);
router.post(
  '/:projectId/intake/:submissionId/spam',
  requireProjectAccess,
  intakeController.markSpam,
);

export default router;
