import { Router } from 'express';

import { authenticate } from '../../middleware/auth';
import { requireTeamMember } from '../../middleware/rbac';

import * as teamsController from './teams.controller';

const router = Router();

router.use(authenticate);

// Creating, changing and deleting teams and their members run through the registry.
// Reading the rest needs team membership (or org OWNER/ADMIN), as its projects do
const teamRead = requireTeamMember();

// Team activity feed
router.get('/:teamId/activity', teamRead, teamsController.getActivity);

// Team member profile
router.get('/:teamId/members/profile/:username', teamRead, teamsController.getMemberProfile);

// Team members
router.get('/:teamId/members', teamRead, teamsController.listMembers);

export default router;
