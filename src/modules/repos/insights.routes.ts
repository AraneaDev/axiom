import { Router } from 'express';

import { authenticate } from '../../middleware/auth';

import * as insightsController from './insights.controller';

const router = Router();

router.use(authenticate);

router.get('/:repoId/insights/commit-frequency', insightsController.commitFrequency);
router.get('/:repoId/insights/contributors', insightsController.contributors);
router.get('/:repoId/insights/languages', insightsController.languages);
router.get('/:repoId/insights/code-frequency', insightsController.codeFrequency);

export default router;
