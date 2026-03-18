import { Request, Response } from 'express';

import * as svc from './pipelines.service';

/**
 *
 * @param req
 * @param res
 */
export async function listPipelines(req: Request, res: Response) {
  res.json(await svc.listPipelines(req.params.repoId));
}

/**
 *
 * @param req
 * @param res
 */
export async function createPipeline(req: Request, res: Response) {
  try {
    res.status(201).json(await svc.createPipeline(req.params.repoId, req.body));
  } catch (err: unknown) {
    const e = err as { status?: number; errors?: string[]; message?: string };
    res.status(e.status ?? 500).json({ error: e.message, errors: e.errors });
  }
}

/**
 *
 * @param req
 * @param res
 */
export async function updatePipeline(req: Request, res: Response) {
  try {
    res.json(await svc.updatePipeline(req.params.pipelineId, req.body));
  } catch (err: unknown) {
    const e = err as { status?: number; errors?: string[]; message?: string };
    res.status(e.status ?? 500).json({ error: e.message, errors: e.errors });
  }
}

/**
 *
 * @param req
 * @param res
 */
export async function deletePipeline(req: Request, res: Response) {
  await svc.deletePipeline(req.params.pipelineId);
  res.status(204).send();
}

/**
 *
 * @param req
 * @param res
 */
export async function listRuns(req: Request, res: Response) {
  const { pipelineId, status, limit } = req.query as Record<string, string>;
  res.json(
    await svc.listRuns(req.params.repoId, {
      pipelineId,
      status,
      limit: limit ? parseInt(limit) : undefined,
    }),
  );
}

/**
 *
 * @param req
 * @param res
 */
export async function getRun(req: Request, res: Response) {
  const run = await svc.getRun(req.params.runId);
  if (!run) {
    res.status(404).json({ error: 'Run not found' });
    return;
  }
  res.json(run);
}

/**
 *
 * @param req
 * @param res
 */
export async function triggerRun(req: Request, res: Response) {
  const run = await svc.triggerRun(
    req.params.pipelineId,
    req.params.repoId,
    req.userId!,
    req.body.ref ?? 'HEAD',
  );
  res.status(201).json(run);
}

/**
 *
 * @param req
 * @param res
 */
export async function cancelRun(req: Request, res: Response) {
  res.json(await svc.cancelRun(req.params.runId));
}

/**
 *
 * @param req
 * @param res
 */
export async function streamLogs(req: Request, res: Response) {
  const { runId } = req.params;
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
}
