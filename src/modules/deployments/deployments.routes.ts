import { Router } from 'express';

import { authenticate } from '../../middleware/auth';
import { asyncHandler } from '../../utils/asyncHandler';

import * as ctrl from './deployments.controller';

const router = Router();

// Environments
router.get('/:repoId/environments', authenticate, asyncHandler(ctrl.listEnvironments));
router.post('/:repoId/environments', authenticate, asyncHandler(ctrl.createEnvironment));
router.patch('/:repoId/environments/:envId', authenticate, asyncHandler(ctrl.updateEnvironment));
router.delete('/:repoId/environments/:envId', authenticate, asyncHandler(ctrl.deleteEnvironment));

// Deployments
router.post(
  '/:repoId/environments/:envId/deployments',
  authenticate,
  asyncHandler(ctrl.createDeployment),
);
router.get(
  '/:repoId/environments/:envId/deployments',
  authenticate,
  asyncHandler(ctrl.listDeployments),
);
router.get(
  '/:repoId/environments/:envId/deployments/:deploymentId',
  authenticate,
  asyncHandler(ctrl.getDeployment),
);

// Deployments by commit
router.get(
  '/:repoId/commits/:sha/deployments',
  authenticate,
  asyncHandler(ctrl.getDeploymentsByCommit),
);

// Environment Variables
router.get(
  '/:repoId/environments/:envId/variables',
  authenticate,
  asyncHandler(ctrl.listEnvVariables),
);
router.post(
  '/:repoId/environments/:envId/variables',
  authenticate,
  asyncHandler(ctrl.createEnvVariable),
);
router.patch(
  '/:repoId/environments/:envId/variables/:variableId',
  authenticate,
  asyncHandler(ctrl.updateEnvVariable),
);
router.delete(
  '/:repoId/environments/:envId/variables/:variableId',
  authenticate,
  asyncHandler(ctrl.deleteEnvVariable),
);

export default router;
