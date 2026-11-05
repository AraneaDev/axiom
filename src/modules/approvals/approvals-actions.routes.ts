import { Router } from 'express';

import { authenticate } from '../../middleware/auth';

import * as approvalsController from './approvals.controller';

const router = Router();
router.use(authenticate);

// The one route left of the approvals: it sits under /api/users and moves with the users
router.get('/users/me/pending-approvals', approvalsController.myPendingApprovals);

export default router;
