import { Router } from 'express';

import { authenticate } from '../../middleware/auth';
import { asyncHandler } from '../../utils/asyncHandler';

import * as ctrl from './releases.controller';

const router = Router();

router.get('/:repoId/releases/compare', authenticate, asyncHandler(ctrl.compareRelease));
router.get('/:repoId/releases', authenticate, asyncHandler(ctrl.listReleases));
router.post('/:repoId/releases', authenticate, asyncHandler(ctrl.createRelease));
router.get('/:repoId/releases/:tagName', authenticate, asyncHandler(ctrl.getRelease));
router.patch('/:repoId/releases/:tagName', authenticate, asyncHandler(ctrl.updateRelease));
router.delete('/:repoId/releases/:tagName', authenticate, asyncHandler(ctrl.deleteRelease));
router.post('/:repoId/releases/:tagName/publish', authenticate, asyncHandler(ctrl.publishRelease));

export default router;
