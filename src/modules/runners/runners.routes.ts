import { Router } from 'express';

import { authenticate } from '../../middleware/auth';

import * as ctrl from './runners.controller';

const router = Router();

router.use(authenticate);

// Org-scoped runners
router.post('/orgs/:orgId/runners/registration-token', ctrl.createRegistrationToken);
router.get('/orgs/:orgId/runners', ctrl.list);
router.get('/orgs/:orgId/runners/:runnerId', ctrl.get);
router.delete('/orgs/:orgId/runners/:runnerId', ctrl.remove);

// Team-scoped runners
router.post('/teams/:teamId/runners/registration-token', ctrl.createRegistrationToken);
router.get('/teams/:teamId/runners', ctrl.list);
router.get('/teams/:teamId/runners/:runnerId', ctrl.get);
router.delete('/teams/:teamId/runners/:runnerId', ctrl.remove);

// Project-scoped runners
router.post('/projects/:projectId/runners/registration-token', ctrl.createRegistrationToken);
router.get('/projects/:projectId/runners', ctrl.list);
router.get('/projects/:projectId/runners/:runnerId', ctrl.get);
router.delete('/projects/:projectId/runners/:runnerId', ctrl.remove);

// Task endpoints (scope-independent, require standard auth)
router.get('/runner-tasks/:taskId', ctrl.getTask);
router.get('/runner-tasks/:taskId/logs', ctrl.streamTaskLogs);

export default router;
