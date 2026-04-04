import type { Request, Response } from 'express';

import { asyncHandler } from '../../utils/asyncHandler';

import * as svc from './connect-rpc.service';
import type { RunnerRequest } from './runner-auth';

export const ping = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ data: 'Hello' });
});

export const register = asyncHandler(async (req: Request, res: Response) => {
  const { name, token, labels, version } = req.body;
  const result = await svc.registerRunner({
    name: name ?? 'unnamed',
    token: token ?? '',
    labels: labels ?? [],
    version: version ?? '',
  });
  res.json(result);
});

export const declare = asyncHandler(async (req: Request, res: Response) => {
  const runner = (req as RunnerRequest).runner!;
  const result = await svc.declareRunner(runner.id, {
    version: req.body.version ?? '',
    labels: req.body.labels ?? [],
  });
  res.json(result);
});

export const fetchTask = asyncHandler(async (req: Request, res: Response) => {
  const runner = (req as RunnerRequest).runner!;
  const result = await svc.fetchTask(runner, req.body.tasksVersion);
  res.json(result);
});

export const updateTask = asyncHandler(async (req: Request, res: Response) => {
  const runner = (req as RunnerRequest).runner!;
  const result = await svc.updateTask(runner.id, req.body.state);
  res.json(result);
});

export const updateLog = asyncHandler(async (req: Request, res: Response) => {
  const runner = (req as RunnerRequest).runner!;
  const result = await svc.updateLog(runner.id, req.body);
  res.json(result);
});
