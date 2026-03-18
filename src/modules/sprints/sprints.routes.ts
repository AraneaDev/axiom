import { Router } from 'express';

import { authenticate } from '../../middleware/auth';
import { requireProjectAccess } from '../../middleware/requireProjectAccess';

import * as sprintsController from './sprints.controller';

const router = Router();

router.use(authenticate);
router.use('/:projectId/sprints', requireProjectAccess);
router.use('/:projectId/velocity', requireProjectAccess);
router.use('/:projectId/backlog', requireProjectAccess);

// Sprint CRUD
router.post('/:projectId/sprints', sprintsController.create);
router.get('/:projectId/sprints', sprintsController.list);
router.get('/:projectId/sprints/:sprintId', sprintsController.get);
router.patch('/:projectId/sprints/:sprintId', sprintsController.update);

// Sprint lifecycle
router.post('/:projectId/sprints/:sprintId/start', sprintsController.start);
router.post('/:projectId/sprints/:sprintId/complete', sprintsController.complete);

// Sprint issue management
router.post('/:projectId/sprints/:sprintId/issues', sprintsController.addIssues);
router.delete('/:projectId/sprints/:sprintId/issues/:issueId', sprintsController.removeIssue);

// Velocity & backlog
router.get('/:projectId/velocity', sprintsController.velocity);
router.get('/:projectId/backlog', sprintsController.backlog);

export default router;
