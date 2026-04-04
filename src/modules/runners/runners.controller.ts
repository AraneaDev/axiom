import type { RunnerScope } from '@prisma/client';
import type { Request, Response } from 'express';

import { asyncHandler } from '../../utils/asyncHandler';
import { param } from '../../utils/params';

import * as svc from './runners.service';

function extractScope(req: Request): { scopeType: RunnerScope; scopeId: string } {
  if (req.params.orgId) return { scopeType: 'ORG', scopeId: param(req, 'orgId') };
  if (req.params.teamId) return { scopeType: 'TEAM', scopeId: param(req, 'teamId') };
  if (req.params.projectId) return { scopeType: 'PROJECT', scopeId: param(req, 'projectId') };
  throw new Error('Could not determine runner scope from route');
}

export const createRegistrationToken = asyncHandler(async (req: Request, res: Response) => {
  const { scopeType, scopeId } = extractScope(req);
  const result = await svc.generateRegistrationToken(scopeType, scopeId);
  res.status(201).json(result);
});

export const list = asyncHandler(async (req: Request, res: Response) => {
  const { scopeType, scopeId } = extractScope(req);
  const runners = await svc.listRunners(scopeType, scopeId);
  res.json(runners);
});

export const get = asyncHandler(async (req: Request, res: Response) => {
  const { scopeType, scopeId } = extractScope(req);
  const runner = await svc.getRunner(param(req, 'runnerId'), scopeType, scopeId);
  res.json(runner);
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  const { scopeType, scopeId } = extractScope(req);
  await svc.deleteRunner(param(req, 'runnerId'), scopeType, scopeId);
  res.status(204).end();
});
