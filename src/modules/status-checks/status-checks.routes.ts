import { Router } from 'express';

import { authenticate } from '../../middleware/auth';

import * as statusChecksController from './status-checks.controller';

const router = Router();

router.use(authenticate);

// Report a status check (e.g. from external CI)
router.post('/:repoId/statuses', statusChecksController.createStatus);

// Get combined status for a commit
router.get('/:repoId/commits/:sha/statuses', statusChecksController.getCommitStatuses);

// Get status checks for a PR's head commit
router.get('/:repoId/pulls/:number/statuses', statusChecksController.getPRStatuses);

export default router;
