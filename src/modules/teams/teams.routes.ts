import { Router } from 'express';

import { authenticate } from '../../middleware/auth';
import { requireOrgPermission, requireTeamPermission } from '../../middleware/rbac';

import * as teamsController from './teams.controller';

const router = Router();

router.use(authenticate);

// Org-scoped team routes
router.post('/org/:orgId', requireOrgPermission('team:create'), teamsController.create);
router.get('/org/:orgId', teamsController.list);

// Team-specific routes
router.get('/:teamId', teamsController.get);
router.patch('/:teamId', requireTeamPermission('team:manage_members'), teamsController.update);
router.delete('/:teamId', requireTeamPermission('team:delete'), teamsController.remove);

// Team members
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
