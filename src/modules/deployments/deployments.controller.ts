import { Request, Response } from 'express';

import { AppError } from '../../middleware/errorHandler';
import { asyncHandler } from '../../utils/asyncHandler';
import { ERR } from '../../utils/error-messages';
import { parsePagination } from '../../utils/pagination';
import { param } from '../../utils/params';
import {
  validate,
  createEnvironmentSchema,
  updateEnvironmentSchema,
  createDeploymentSchema,
} from '../../utils/validation';

import * as svc from './deployments.service';

export const createEnvironment = asyncHandler(async (req: Request, res: Response) => {
  const repoId = param(req, 'repoId');
  const body = validate(createEnvironmentSchema, req.body);
  const env = await svc.createEnvironment(repoId, body);
  res.status(201).json(env);
});

export const listEnvironments = asyncHandler(async (req: Request, res: Response) => {
  const repoId = param(req, 'repoId');
  res.json(await svc.listEnvironments(repoId));
});

export const updateEnvironment = asyncHandler(async (req: Request, res: Response) => {
  const envId = param(req, 'envId');
  const body = validate(updateEnvironmentSchema, req.body);
  res.json(await svc.updateEnvironment(envId, body));
});

export const deleteEnvironment = asyncHandler(async (req: Request, res: Response) => {
  const envId = param(req, 'envId');
  await svc.deleteEnvironment(envId);
  res.status(204).send();
});

export const createDeployment = asyncHandler(async (req: Request, res: Response) => {
  const envId = param(req, 'envId');
  const body = validate(createDeploymentSchema, req.body);
  const deployment = await svc.createDeployment(envId, {
    ...body,
    deployedById: req.userId!,
  });
  res.status(201).json(deployment);
});

export const listDeployments = asyncHandler(async (req: Request, res: Response) => {
  const envId = param(req, 'envId');
  const { take, skip } = parsePagination(req.query as Record<string, string>);
  res.json(await svc.listDeployments(envId, { limit: take, offset: skip }));
});

export const getDeployment = asyncHandler(async (req: Request, res: Response) => {
  const deploymentId = param(req, 'deploymentId');
  const deployment = await svc.getDeployment(deploymentId);
  if (!deployment) {
    throw new AppError(404, ERR.DEPLOYMENT_NOT_FOUND);
  }
  res.json(deployment);
});

export const getDeploymentsByCommit = asyncHandler(async (req: Request, res: Response) => {
  const repoId = param(req, 'repoId');
  const sha = param(req, 'sha');
  res.json(await svc.getDeploymentsByCommit(repoId, sha));
});

// Environment Variables

export const listEnvVariables = asyncHandler(async (req: Request, res: Response) => {
  const envId = param(req, 'envId');
  res.json(await svc.listEnvVariables(envId));
});

export const createEnvVariable = asyncHandler(async (req: Request, res: Response) => {
  const envId = param(req, 'envId');
  const { name, value } = req.body;
  if (!name || !value) throw new AppError(400, 'name and value are required');
  const variable = await svc.upsertEnvVariable(envId, name, value);
  res.status(201).json(variable);
});

export const updateEnvVariable = asyncHandler(async (req: Request, res: Response) => {
  const envId = param(req, 'envId');
  const { name, value } = req.body;
  if (!name || !value) throw new AppError(400, 'name and value are required');
  const variable = await svc.upsertEnvVariable(envId, name, value);
  res.json(variable);
});

export const deleteEnvVariable = asyncHandler(async (req: Request, res: Response) => {
  const variableId = param(req, 'variableId');
  await svc.deleteEnvVariable(variableId);
  res.status(204).send();
});
