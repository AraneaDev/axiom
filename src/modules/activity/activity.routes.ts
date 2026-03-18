import { Router } from 'express';

import { authenticate } from '../../middleware/auth';
import { requireProjectAccess } from '../../middleware/requireProjectAccess';

import * as activityController from './activity.controller';

const router = Router();

router.use(authenticate);
router.use('/:projectId/activity', requireProjectAccess);
router.use('/:projectId/issues/:issueNumber/activity', requireProjectAccess);

router.get('/:projectId/activity', activityController.listProjectActivity);
router.get('/:projectId/issues/:issueNumber/activity', activityController.listIssueActivity);

export default router;
