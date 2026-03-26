import { Request, Response } from 'express';

import { AppError } from '../../middleware/errorHandler';
import { asyncHandler } from '../../utils/asyncHandler';
import { param } from '../../utils/params';
import {
  validate,
  createPipelineSchema,
  updatePipelineSchema,
  triggerRunSchema,
} from '../../utils/validation';

import * as svc from './pipelines.service';

export const listPipelines = asyncHandler(async (req: Request, res: Response) => {
  res.json(await svc.listPipelines(param(req, 'repoId')));
});

export const createPipeline = asyncHandler(async (req: Request, res: Response) => {
  const body = validate(createPipelineSchema, req.body);
  res.status(201).json(await svc.createPipeline(param(req, 'repoId'), body));
});

export const updatePipeline = asyncHandler(async (req: Request, res: Response) => {
  const body = validate(updatePipelineSchema, req.body);
  res.json(await svc.updatePipeline(param(req, 'pipelineId'), body));
});

export const deletePipeline = asyncHandler(async (req: Request, res: Response) => {
  await svc.deletePipeline(param(req, 'pipelineId'));
  res.status(204).send();
});

export const listRuns = asyncHandler(async (req: Request, res: Response) => {
  const { pipelineId, status, limit } = req.query as Record<string, string>;
  res.json(
    await svc.listRuns(param(req, 'repoId'), {
      pipelineId,
      status,
      limit: limit ? parseInt(limit, 10) : undefined,
    }),
  );
});

export const getRun = asyncHandler(async (req: Request, res: Response) => {
  const run = await svc.getRun(param(req, 'runId'));
  if (!run) {
    throw new AppError(404, 'Run not found');
  }
  res.json(run);
});

export const triggerRun = asyncHandler(async (req: Request, res: Response) => {
  const body = validate(triggerRunSchema, req.body);
  const run = await svc.triggerRun(
    param(req, 'pipelineId'),
    param(req, 'repoId'),
    req.userId!,
    body.ref,
  );
  res.status(201).json(run);
});

export const cancelRun = asyncHandler(async (req: Request, res: Response) => {
  res.json(await svc.cancelRun(param(req, 'runId')));
});

export const streamLogs = asyncHandler(async (req: Request, res: Response) => {
  const runId = param(req, 'runId');
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = (data: unknown) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  const poll = setInterval(async () => {
    try {
      const run = await svc.getRun(runId);
      if (!run) {
        clearInterval(poll);
        res.write('event: done\ndata: {}\n\n');
        res.end();
        return;
      }
      send({ jobs: run.jobs });
      const terminal = ['SUCCESS', 'FAILURE', 'CANCELLED'];
      if (terminal.includes(run.status)) {
        clearInterval(poll);
        res.write('event: done\ndata: {}\n\n');
        res.end();
      }
    } catch {
      clearInterval(poll);
      res.end();
    }
  }, 750);

  req.on('close', () => clearInterval(poll));
});
