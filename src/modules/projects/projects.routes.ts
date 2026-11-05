import { Router } from 'express';

import { authenticate } from '../../middleware/auth';
import { requireProjectAccess } from '../../middleware/requireProjectAccess';

import * as projectsController from './projects.controller';

const router = Router();

router.use(authenticate);

// Everything on a project itself runs through the registry, but for its analytics
router.get('/:projectId/analytics', requireProjectAccess, projectsController.analytics);

export default router;
