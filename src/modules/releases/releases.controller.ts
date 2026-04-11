import { Request, Response } from 'express';

import { AppError } from '../../middleware/errorHandler';
import { asyncHandler } from '../../utils/asyncHandler';
import { ERR } from '../../utils/error-messages';
import { param } from '../../utils/params';
import { validate, createReleaseSchema, updateReleaseSchema } from '../../utils/validation';

import * as svc from './releases.service';

export const listReleases = asyncHandler(async (req: Request, res: Response) => {
  const repoId = param(req, 'repoId');
  const draft = req.query.draft !== undefined ? req.query.draft === 'true' : undefined;
  const prerelease =
    req.query.prerelease !== undefined ? req.query.prerelease === 'true' : undefined;
  res.json(await svc.listReleases(repoId, { draft, prerelease }));
});

export const getRelease = asyncHandler(async (req: Request, res: Response) => {
  const repoId = param(req, 'repoId');
  const tagName = param(req, 'tagName');
  const release = await svc.getRelease(repoId, tagName);
  if (!release) {
    throw new AppError(404, ERR.RELEASE_NOT_FOUND);
  }
  res.json(release);
});

export const createRelease = asyncHandler(async (req: Request, res: Response) => {
  const repoId = param(req, 'repoId');
  const body = validate(createReleaseSchema, req.body);
  const release = await svc.createRelease(repoId, req.userId!, body);
  res.status(201).json(release);
});

export const updateRelease = asyncHandler(async (req: Request, res: Response) => {
  const repoId = param(req, 'repoId');
  const tagName = param(req, 'tagName');
  const body = validate(updateReleaseSchema, req.body);
  res.json(await svc.updateRelease(repoId, tagName, body));
});

export const publishRelease = asyncHandler(async (req: Request, res: Response) => {
  const repoId = param(req, 'repoId');
  const tagName = param(req, 'tagName');
  res.json(await svc.publishRelease(repoId, tagName));
});

export const deleteRelease = asyncHandler(async (req: Request, res: Response) => {
  const repoId = param(req, 'repoId');
  const tagName = param(req, 'tagName');
  await svc.deleteRelease(repoId, tagName);
  res.status(204).send();
});

export const compareRelease = asyncHandler(async (req: Request, res: Response) => {
  const repoId = param(req, 'repoId');
  const { base, head } = req.query as { base: string; head: string };
  res.json(await svc.compareRelease(repoId, base, head));
});

export const deployRelease = asyncHandler(async (req: Request, res: Response) => {
  const repoId = param(req, 'repoId');
  const tagName = param(req, 'tagName');
  const { environmentId } = req.body;
  if (!environmentId) throw new AppError(400, 'environmentId is required');
  const deployment = await svc.deployRelease(repoId, tagName, environmentId, req.userId!);
  res.status(201).json(deployment);
});

export const listReleaseDeployments = asyncHandler(async (req: Request, res: Response) => {
  const repoId = param(req, 'repoId');
  const tagName = param(req, 'tagName');
  res.json(await svc.listReleaseDeployments(repoId, tagName));
});
