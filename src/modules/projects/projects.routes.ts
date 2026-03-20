import { Router } from 'express';

import { authenticate } from '../../middleware/auth';
import { csrfGuard } from '../../middleware/csrfGuard';
import { requireTeamPermission } from '../../middleware/rbac';
import { requireProjectAccess } from '../../middleware/requireProjectAccess';

import * as projectsController from './projects.controller';

const router = Router();

router.use(authenticate);

router.post('/team/:teamId', requireTeamPermission('project:create'), projectsController.create);
router.get('/team/:teamId', requireTeamPermission('issue:view'), projectsController.list);
router.get('/:projectId', requireProjectAccess, projectsController.get);
router.get('/:projectId/analytics', requireProjectAccess, projectsController.analytics);
router.patch('/:projectId', requireProjectAccess, csrfGuard, projectsController.update);
router.delete('/:projectId', requireProjectAccess, csrfGuard, projectsController.remove);

export default router;
