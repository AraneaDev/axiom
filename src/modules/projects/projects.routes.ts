import { Router } from 'express';

import { authenticate } from '../../middleware/auth';
import { requireTeamPermission } from '../../middleware/rbac';

import * as projectsController from './projects.controller';

const router = Router();

router.use(authenticate);

router.post('/team/:teamId', requireTeamPermission('project:create'), projectsController.create);
router.get('/team/:teamId', projectsController.list);
router.get('/:projectId', projectsController.get);
router.patch('/:projectId', projectsController.update);
router.delete('/:projectId', projectsController.remove);

export default router;
