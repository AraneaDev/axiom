import { Router } from 'express';

import { authenticate } from '../../middleware/auth';
import { requireTeamMember } from '../../middleware/rbac';

import * as teamRoadmapController from './team-roadmap.controller';

const router = Router();

router.use(authenticate);

router.get(
  '/teams/:teamId/roadmap/timeline',
  requireTeamMember(),
  teamRoadmapController.getTeamTimeline,
);

export default router;
