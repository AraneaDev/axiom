import { Router } from 'express';

import { prisma } from '../../config/database';
import { authenticate } from '../../middleware/auth';
import { requireProjectAccessVia } from '../../middleware/requireProjectAccess';
import { ERR } from '../../utils/error-messages';

import * as approvalsController from './approvals.controller';

const router = Router();
router.use(authenticate);

// Approval requests belong to an issue: the user needs access to its project
const issueAccess = requireProjectAccessVia(
  'issueId',
  async (id) =>
    (await prisma.issue.findUnique({ where: { id }, select: { projectId: true } }))?.projectId,
  ERR.ISSUE_NOT_FOUND,
);
const requestAccess = requireProjectAccessVia(
  'requestId',
  async (id) =>
    (
      await prisma.approvalRequest.findUnique({
        where: { id },
        select: { issue: { select: { projectId: true } } },
      })
    )?.issue.projectId,
  'Approval request not found',
);

router.post(
  '/issues/:issueId/approval-requests/:targetColumnId',
  issueAccess,
  approvalsController.createRequest,
);
router.get(
  '/issues/:issueId/approval-requests',
  issueAccess,
  approvalsController.listRequestsForIssue,
);
router.post('/approval-requests/:requestId/vote', requestAccess, approvalsController.vote);
router.post(
  '/approval-requests/:requestId/cancel',
  requestAccess,
  approvalsController.cancelRequest,
);
router.get('/users/me/pending-approvals', approvalsController.myPendingApprovals);

export default router;
