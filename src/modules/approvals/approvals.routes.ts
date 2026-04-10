import { Router } from 'express';

import { authenticate } from '../../middleware/auth';
import { requireProjectAccess } from '../../middleware/requireProjectAccess';

import * as approvalsController from './approvals.controller';

const router = Router();
router.use(authenticate);

router.get('/:projectId/approval-gates', requireProjectAccess, approvalsController.listGates);
router.post('/:projectId/approval-gates', requireProjectAccess, approvalsController.createGate);
router.patch(
  '/:projectId/approval-gates/:gateId',
  requireProjectAccess,
  approvalsController.updateGate,
);
router.delete(
  '/:projectId/approval-gates/:gateId',
  requireProjectAccess,
  approvalsController.deleteGate,
);
router.get(
  '/:projectId/approval-requests/pending',
  requireProjectAccess,
  approvalsController.listPendingForProject,
);

export default router;
