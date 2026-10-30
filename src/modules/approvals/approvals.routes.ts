import { Router } from 'express';

import { authenticate } from '../../middleware/auth';
import { requireProjectAccess, requireProjectWrite } from '../../middleware/requireProjectAccess';

import * as approvalsController from './approvals.controller';

const router = Router();
router.use(authenticate);
// Writes follow the permission matrix: VIEWERs and GUESTs can read, not change
router.use('/:projectId', requireProjectWrite());
// Project settings: team ADMINs, org OWNERs/ADMINs and platform admins only
router.use('/:projectId/approval-gates', requireProjectWrite('team:manage_members'));

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
