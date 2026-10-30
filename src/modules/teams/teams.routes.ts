import { Router } from 'express';

import { authenticate } from '../../middleware/auth';
import {
  requireOrgMember,
  requireOrgPermission,
  requireTeamMember,
  requireTeamPermission,
} from '../../middleware/rbac';

import * as teamsController from './teams.controller';

const router = Router();

router.use(authenticate);

// Org-scoped team routes
router.post('/org/:orgId', requireOrgPermission('team:create'), teamsController.create);
router.get('/org/:orgId', requireOrgMember(), teamsController.list);

// Team-specific routes
// Reading a team needs team membership (or org OWNER/ADMIN), as its projects do
const teamRead = requireTeamMember();
router.get('/:teamId', teamRead, teamsController.get);
router.patch('/:teamId', requireTeamPermission('team:manage_members'), teamsController.update);
router.delete('/:teamId', requireTeamPermission('team:delete'), teamsController.remove);

// Team activity feed
router.get('/:teamId/activity', teamRead, teamsController.getActivity);

// Team member profile
router.get('/:teamId/members/profile/:username', teamRead, teamsController.getMemberProfile);

// Team members
router.get('/:teamId/members', teamRead, teamsController.listMembers);
router.post(
  '/:teamId/members',
  requireTeamPermission('team:manage_members'),
  teamsController.addMember,
);
router.patch(
  '/:teamId/members/:memberId',
  requireTeamPermission('team:manage_members'),
  teamsController.updateMemberRole,
);
router.delete(
  '/:teamId/members/:memberId',
  requireTeamPermission('team:manage_members'),
  teamsController.removeMember,
);

export default router;
