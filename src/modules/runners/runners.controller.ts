import type { RunnerScope } from '@prisma/client';
import type { Request, Response } from 'express';

import { AppError } from '../../middleware/errorHandler';
import { asyncHandler } from '../../utils/asyncHandler';
import { param } from '../../utils/params';

import * as svc from './runners.service';

function extractScope(req: Request): { scopeType: RunnerScope; scopeId: string } {
  if (req.params.orgId) return { scopeType: 'ORG', scopeId: param(req, 'orgId') };
  if (req.params.teamId) return { scopeType: 'TEAM', scopeId: param(req, 'teamId') };
  if (req.params.projectId) return { scopeType: 'PROJECT', scopeId: param(req, 'projectId') };
  throw new AppError(400, 'Could not determine runner scope from route');
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

export const getTask = asyncHandler(async (req: Request, res: Response) => {
  const task = await svc.getTask(param(req, 'taskId'));
  res.json(task);
});

export const streamTaskLogs = asyncHandler(async (req: Request, res: Response) => {
  const taskId = param(req, 'taskId');
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  let lastIndex = -1;
  const send = (data: unknown) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  const poll = setInterval(async () => {
    try {
      const status = await svc.getTaskStatus(taskId);
      if (!status) {
        clearInterval(poll);
        res.write('event: done\ndata: {}\n\n');
        res.end();
        return;
      }

      const lines = await svc.getTaskLogsSince(taskId, lastIndex);

      if (lines.length > 0) {
        lastIndex = lines[lines.length - 1].lineIndex;
        send({
          lines: lines.map((l) => ({
            index: l.lineIndex,
            content: l.content,
            timestamp: l.timestamp,
          })),
        });
      }

      const terminal = ['SUCCESS', 'FAILURE', 'CANCELLED'];
      if (terminal.includes(status)) {
        clearInterval(poll);
        res.write('event: done\ndata: {}\n\n');
        res.end();
      }
    } catch {
      clearInterval(poll);
      res.end();
    }
  }, 500);

  req.on('close', () => clearInterval(poll));
});
