import { Router } from 'express';

import { authenticate } from '../../middleware/auth';
import { requireTeamPermission } from '../../middleware/rbac';

import * as teamRoadmapController from './team-roadmap.controller';

const router = Router();

router.use(authenticate);

router.get(
  '/teams/:teamId/roadmap/timeline',
  requireTeamPermission('issue:view'),
  teamRoadmapController.getTeamTimeline,
);

export default router;
