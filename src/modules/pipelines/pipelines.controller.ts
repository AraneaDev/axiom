import { Request, Response, NextFunction } from 'express';

import { AppError } from '../../middleware/errorHandler';
import { param } from '../../utils/params';
import {
  validate,
  createPipelineSchema,
  updatePipelineSchema,
  triggerRunSchema,
} from '../../utils/validation';

import * as svc from './pipelines.service';

/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function listPipelines(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await svc.listPipelines(param(req, 'repoId')));
  } catch (err) {
    next(err);
  }
}

/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function createPipeline(req: Request, res: Response, next: NextFunction) {
  try {
    const body = validate(createPipelineSchema, req.body);
    res.status(201).json(await svc.createPipeline(param(req, 'repoId'), body));
  } catch (err) {
    next(err);
  }
}

/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function updatePipeline(req: Request, res: Response, next: NextFunction) {
  try {
    const body = validate(updatePipelineSchema, req.body);
    res.json(await svc.updatePipeline(param(req, 'pipelineId'), body));
  } catch (err) {
    next(err);
  }
}

/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function deletePipeline(req: Request, res: Response, next: NextFunction) {
  try {
    await svc.deletePipeline(param(req, 'pipelineId'));
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function listRuns(req: Request, res: Response, next: NextFunction) {
  try {
    const { pipelineId, status, limit } = req.query as Record<string, string>;
    res.json(
      await svc.listRuns(param(req, 'repoId'), {
        pipelineId,
        status,
        limit: limit ? parseInt(limit, 10) : undefined,
      }),
    );
  } catch (err) {
    next(err);
  }
}

/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function getRun(req: Request, res: Response, next: NextFunction) {
  try {
    const run = await svc.getRun(param(req, 'runId'));
    if (!run) {
      throw new AppError(404, 'Run not found');
    }
    res.json(run);
  } catch (err) {
    next(err);
  }
}

/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function triggerRun(req: Request, res: Response, next: NextFunction) {
  try {
    const body = validate(triggerRunSchema, req.body);
    const run = await svc.triggerRun(
      param(req, 'pipelineId'),
      param(req, 'repoId'),
      req.userId!,
      body.ref,
    );
    res.status(201).json(run);
  } catch (err) {
    next(err);
  }
}

/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function cancelRun(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await svc.cancelRun(param(req, 'runId')));
  } catch (err) {
    next(err);
  }
}

/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function streamLogs(req: Request, res: Response, next: NextFunction) {
  try {
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
  } catch (err) {
    next(err);
  }
}
