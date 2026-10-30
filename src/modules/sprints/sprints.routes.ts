import { Router } from 'express';

import { authenticate } from '../../middleware/auth';
import {
  projectOf,
  requireProjectAccess,
  requireOwnedByProject,
  requireProjectWrite,
} from '../../middleware/requireProjectAccess';
import { hydrateBacklog } from '../issues/backlog-hydrate.controller';

import * as sprintsController from './sprints.controller';

const router = Router();

router.use(authenticate);
// Writes follow the permission matrix: VIEWERs and GUESTs can read, not change
router.use('/:projectId', requireProjectWrite());

router.use('/:projectId/sprints', requireProjectAccess);
router.use('/:projectId/velocity', requireProjectAccess);
router.use('/:projectId/backlog', requireProjectAccess);
// A sprint id, and an issue id under it, must belong to the project in the URL
router.use('/:projectId/sprints/:sprintId', requireOwnedByProject('sprintId', projectOf.sprint));
router.use(
  '/:projectId/sprints/:sprintId/issues/:issueId',
  requireOwnedByProject('issueId', projectOf.issue),
);

// Sprint CRUD
router.post('/:projectId/sprints', sprintsController.create);
router.get('/:projectId/sprints', sprintsController.list);
router.get('/:projectId/sprints/:sprintId', sprintsController.get);
router.patch('/:projectId/sprints/:sprintId', sprintsController.update);

// Sprint lifecycle
router.post('/:projectId/sprints/:sprintId/start', sprintsController.start);
router.post('/:projectId/sprints/:sprintId/complete', sprintsController.complete);

// Sprint report
router.get('/:projectId/sprints/:sprintId/report', sprintsController.report);

// Sprint issue management
router.post('/:projectId/sprints/:sprintId/issues', sprintsController.addIssues);
router.delete('/:projectId/sprints/:sprintId/issues/:issueId', sprintsController.removeIssue);

// Velocity & backlog
router.get('/:projectId/velocity', sprintsController.velocity);
router.get('/:projectId/backlog/hydrate', hydrateBacklog);
router.get('/:projectId/backlog', sprintsController.backlog);

export default router;
