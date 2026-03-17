import { Router } from 'express';
import * as projectsController from './projects.controller';
import { authenticate } from '../../middleware/auth';
import { requireTeamPermission } from '../../middleware/rbac';

const router = Router();

router.use(authenticate);

router.post('/team/:teamId', requireTeamPermission('project:create'), projectsController.create);
router.get('/team/:teamId', projectsController.list);
router.get('/:projectId', projectsController.get);
router.patch('/:projectId', projectsController.update);
router.delete('/:projectId', projectsController.remove);

export default router;
