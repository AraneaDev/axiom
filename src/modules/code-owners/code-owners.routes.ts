import { Router } from 'express';

import { authenticate } from '../../middleware/auth';

import * as codeOwnersController from './code-owners.controller';

const router = Router();

router.use(authenticate);

// Get code owners for a PR's changed files
router.get('/:repoId/pulls/:number/code-owners', codeOwnersController.getPROwners);

export default router;
