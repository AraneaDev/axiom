import { Request, Response, NextFunction } from 'express';

import { AppError } from '../../middleware/errorHandler';
import { parsePagination } from '../../utils/pagination';
import { param } from '../../utils/params';
import {
  validate,
  createEnvironmentSchema,
  updateEnvironmentSchema,
  createDeploymentSchema,
} from '../../utils/validation';

import * as svc from './deployments.service';

/**
 * POST /:repoId/environments
 * @param req
 * @param res
 * @param next
 */
export async function createEnvironment(req: Request, res: Response, next: NextFunction) {
  try {
    const repoId = param(req, 'repoId');
    const body = validate(createEnvironmentSchema, req.body);
    const env = await svc.createEnvironment(repoId, body);
    res.status(201).json(env);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /:repoId/environments
 * @param req
 * @param res
 * @param next
 */
export async function listEnvironments(req: Request, res: Response, next: NextFunction) {
  try {
    const repoId = param(req, 'repoId');
    res.json(await svc.listEnvironments(repoId));
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /:repoId/environments/:envId
 * @param req
 * @param res
 * @param next
 */
export async function updateEnvironment(req: Request, res: Response, next: NextFunction) {
  try {
    const envId = param(req, 'envId');
    const body = validate(updateEnvironmentSchema, req.body);
    res.json(await svc.updateEnvironment(envId, body));
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /:repoId/environments/:envId
 * @param req
 * @param res
 * @param next
 */
export async function deleteEnvironment(req: Request, res: Response, next: NextFunction) {
  try {
    const envId = param(req, 'envId');
    await svc.deleteEnvironment(envId);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

/**
 * POST /:repoId/environments/:envId/deployments
 * @param req
 * @param res
 * @param next
 */
export async function createDeployment(req: Request, res: Response, next: NextFunction) {
  try {
    const envId = param(req, 'envId');
    const body = validate(createDeploymentSchema, req.body);
    const deployment = await svc.createDeployment(envId, {
      ...body,
      deployedById: req.userId!,
    });
    res.status(201).json(deployment);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /:repoId/environments/:envId/deployments
 * @param req
 * @param res
 * @param next
 */
export async function listDeployments(req: Request, res: Response, next: NextFunction) {
  try {
    const envId = param(req, 'envId');
    const { take, skip } = parsePagination(req.query as Record<string, string>);
    res.json(await svc.listDeployments(envId, { limit: take, offset: skip }));
  } catch (err) {
    next(err);
  }
}

/**
 * GET /:repoId/environments/:envId/deployments/:deploymentId
 * @param req
 * @param res
 * @param next
 */
export async function getDeployment(req: Request, res: Response, next: NextFunction) {
  try {
    const deploymentId = param(req, 'deploymentId');
    const deployment = await svc.getDeployment(deploymentId);
    if (!deployment) {
      throw new AppError(404, 'Deployment not found');
    }
    res.json(deployment);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /:repoId/commits/:sha/deployments
 * @param req
 * @param res
 * @param next
 */
export async function getDeploymentsByCommit(req: Request, res: Response, next: NextFunction) {
  try {
    const repoId = param(req, 'repoId');
    const sha = param(req, 'sha');
    res.json(await svc.getDeploymentsByCommit(repoId, sha));
  } catch (err) {
    next(err);
  }
}

// ─── Environment Variables ──────────────────────────────────

/**
 * GET /:repoId/environments/:envId/variables
 * @param req
 * @param res
 * @param next
 */
export async function listEnvVariables(req: Request, res: Response, next: NextFunction) {
  try {
    const envId = param(req, 'envId');
    res.json(await svc.listEnvVariables(envId));
  } catch (err) {
    next(err);
  }
}

/**
 * POST /:repoId/environments/:envId/variables
 * @param req
 * @param res
 * @param next
 */
export async function createEnvVariable(req: Request, res: Response, next: NextFunction) {
  try {
    const envId = param(req, 'envId');
    const { name, value } = req.body;
    if (!name || !value) throw new AppError(400, 'name and value are required');
    const variable = await svc.upsertEnvVariable(envId, name, value);
    res.status(201).json(variable);
  } catch (err) {
    next(err);
  }
}

/**
 * PUT /:repoId/environments/:envId/variables/:variableId
 * @param req
 * @param res
 * @param next
 */
export async function updateEnvVariable(req: Request, res: Response, next: NextFunction) {
  try {
    const envId = param(req, 'envId');
    const { name, value } = req.body;
    if (!name || !value) throw new AppError(400, 'name and value are required');
    const variable = await svc.upsertEnvVariable(envId, name, value);
    res.json(variable);
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /:repoId/environments/:envId/variables/:variableId
 * @param req
 * @param res
 * @param next
 */
export async function deleteEnvVariable(req: Request, res: Response, next: NextFunction) {
  try {
    const variableId = param(req, 'variableId');
    await svc.deleteEnvVariable(variableId);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}
