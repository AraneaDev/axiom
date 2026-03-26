import { Router } from 'express';

import { authenticate } from '../../middleware/auth';

import * as ctrl from './deployments.controller';

const router = Router();

// Environments
router.get('/:repoId/environments', authenticate, ctrl.listEnvironments);
router.post('/:repoId/environments', authenticate, ctrl.createEnvironment);
router.patch('/:repoId/environments/:envId', authenticate, ctrl.updateEnvironment);
router.delete('/:repoId/environments/:envId', authenticate, ctrl.deleteEnvironment);

// Deployments
router.post('/:repoId/environments/:envId/deployments', authenticate, ctrl.createDeployment);
router.get('/:repoId/environments/:envId/deployments', authenticate, ctrl.listDeployments);
router.get(
  '/:repoId/environments/:envId/deployments/:deploymentId',
  authenticate,
  ctrl.getDeployment,
);

// Deployments by commit
router.get('/:repoId/commits/:sha/deployments', authenticate, ctrl.getDeploymentsByCommit);

// Environment Variables
router.get('/:repoId/environments/:envId/variables', authenticate, ctrl.listEnvVariables);
router.post('/:repoId/environments/:envId/variables', authenticate, ctrl.createEnvVariable);
router.patch(
  '/:repoId/environments/:envId/variables/:variableId',
  authenticate,
  ctrl.updateEnvVariable,
);
router.delete(
  '/:repoId/environments/:envId/variables/:variableId',
  authenticate,
  ctrl.deleteEnvVariable,
);

export default router;
