import { Router } from 'express';

import { authenticate } from '../../middleware/auth';

import * as approvalsController from './approvals.controller';

const router = Router();
router.use(authenticate);

router.post(
  '/issues/:issueId/approval-requests/:targetColumnId',
  approvalsController.createRequest,
);
router.get('/issues/:issueId/approval-requests', approvalsController.listRequestsForIssue);
router.post('/approval-requests/:requestId/vote', approvalsController.vote);
router.post('/approval-requests/:requestId/cancel', approvalsController.cancelRequest);
router.get('/users/me/pending-approvals', approvalsController.myPendingApprovals);

export default router;
