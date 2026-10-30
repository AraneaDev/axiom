import { Router } from 'express';

import { authenticate } from '../../middleware/auth';
import { csrfGuard } from '../../middleware/csrfGuard';
import { requireTeamMember, requireTeamPermission } from '../../middleware/rbac';
import { requireProjectAccess, requireProjectAction } from '../../middleware/requireProjectAccess';

import * as projectsController from './projects.controller';

const router = Router();

router.use(authenticate);

// Creating in a team needs what reading it needs (team membership), then the role
router.post(
  '/team/:teamId',
  requireTeamMember(),
  requireTeamPermission('project:create'),
  projectsController.create,
);
router.get('/team/:teamId', requireTeamMember(), projectsController.list);
router.get('/:projectId', requireProjectAccess, projectsController.get);
router.get('/:projectId/analytics', requireProjectAccess, projectsController.analytics);
router.patch(
  '/:projectId',
  requireProjectAccess,
  requireProjectAction('team:manage_members'),
  csrfGuard,
  projectsController.update,
);
router.delete(
  '/:projectId',
  requireProjectAccess,
  requireProjectAction('project:delete'),
  csrfGuard,
  projectsController.remove,
);

export default router;
