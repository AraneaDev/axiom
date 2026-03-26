import { Router } from 'express';

import { authenticate } from '../../middleware/auth';

import * as ctrl from './releases.controller';

const router = Router();

router.get('/:repoId/releases/compare', authenticate, ctrl.compareRelease);
router.get('/:repoId/releases', authenticate, ctrl.listReleases);
router.post('/:repoId/releases', authenticate, ctrl.createRelease);
router.get('/:repoId/releases/:tagName', authenticate, ctrl.getRelease);
router.patch('/:repoId/releases/:tagName', authenticate, ctrl.updateRelease);
router.delete('/:repoId/releases/:tagName', authenticate, ctrl.deleteRelease);
router.post('/:repoId/releases/:tagName/publish', authenticate, ctrl.publishRelease);
router.post('/:repoId/releases/:tagName/deploy', authenticate, ctrl.deployRelease);
router.get('/:repoId/releases/:tagName/deployments', authenticate, ctrl.listReleaseDeployments);

export default router;
