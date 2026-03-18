import { Request, Response } from 'express';

import { param } from '../../utils/params';

import * as svc from './deployments.service';

/**
 * POST /:repoId/environments
 * @param req
 * @param res
 */
export async function createEnvironment(req: Request, res: Response) {
  const repoId = param(req, 'repoId');
  const { name, url, protectionRules } = req.body;
  if (!name) {
    res.status(400).json({ error: { message: 'name is required' } });
    return;
  }
  const env = await svc.createEnvironment(repoId, { name, url, protectionRules });
  res.status(201).json(env);
}

/**
 * GET /:repoId/environments
 * @param req
 * @param res
 */
export async function listEnvironments(req: Request, res: Response) {
  const repoId = param(req, 'repoId');
  res.json(await svc.listEnvironments(repoId));
}

/**
 * PATCH /:repoId/environments/:envId
 * @param req
 * @param res
 */
export async function updateEnvironment(req: Request, res: Response) {
  const envId = param(req, 'envId');
  const { name, url, protectionRules } = req.body;
  res.json(await svc.updateEnvironment(envId, { name, url, protectionRules }));
}

/**
 * DELETE /:repoId/environments/:envId
 * @param req
 * @param res
 */
export async function deleteEnvironment(req: Request, res: Response) {
  const envId = param(req, 'envId');
  await svc.deleteEnvironment(envId);
  res.status(204).end();
}

/**
 * POST /:repoId/environments/:envId/deployments
 * @param req
 * @param res
 */
export async function createDeployment(req: Request, res: Response) {
  const envId = param(req, 'envId');
  const { commitSha, pipelineRunId, status } = req.body;
  if (!commitSha) {
    res.status(400).json({ error: { message: 'commitSha is required' } });
    return;
  }
  const deployment = await svc.createDeployment(envId, {
    commitSha,
    pipelineRunId,
    deployedById: req.userId!,
    status,
  });
  res.status(201).json(deployment);
}

/**
 * GET /:repoId/environments/:envId/deployments
 * @param req
 * @param res
 */
export async function listDeployments(req: Request, res: Response) {
  const envId = param(req, 'envId');
  const limit = req.query.limit ? Number(req.query.limit) : undefined;
  const offset = req.query.offset ? Number(req.query.offset) : undefined;
  res.json(await svc.listDeployments(envId, { limit, offset }));
}

/**
 * GET /:repoId/environments/:envId/deployments/:deploymentId
 * @param req
 * @param res
 */
export async function getDeployment(req: Request, res: Response) {
  const deploymentId = param(req, 'deploymentId');
  const deployment = await svc.getDeployment(deploymentId);
  if (!deployment) {
    res.status(404).json({ error: { message: 'Deployment not found' } });
    return;
  }
  res.json(deployment);
}

/**
 * GET /:repoId/commits/:sha/deployments
 * @param req
 * @param res
 */
export async function getDeploymentsByCommit(req: Request, res: Response) {
  const repoId = param(req, 'repoId');
  const sha = param(req, 'sha');
  res.json(await svc.getDeploymentsByCommit(repoId, sha));
}
