import { Request, Response } from 'express';

import { AppError } from '../../middleware/errorHandler';
import { asyncHandler } from '../../utils/asyncHandler';
import { param, paramInt } from '../../utils/params';

import * as statusChecksService from './status-checks.service';

export const createStatus = asyncHandler(async (req: Request, res: Response) => {
  const { sha, context, state, targetUrl, description } = req.body;
  if (!sha || !context || !state) {
    throw new AppError(400, 'sha, context, and state are required');
  }
  const status = await statusChecksService.createOrUpdateStatus(param(req, 'repoId'), sha, {
    context,
    state,
    targetUrl,
    description,
  });
  res.status(201).json(status);
});

export const getCommitStatuses = asyncHandler(async (req: Request, res: Response) => {
  const combined = await statusChecksService.getCombinedStatus(
    param(req, 'repoId'),
    param(req, 'sha'),
  );
  res.json(combined);
});

export const getPRStatuses = asyncHandler(async (req: Request, res: Response) => {
  const result = await statusChecksService.getStatusesForPR(
    param(req, 'repoId'),
    paramInt(req, 'number'),
  );
  res.json(result);
});
