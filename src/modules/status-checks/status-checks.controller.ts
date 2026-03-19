import { Request, Response, NextFunction } from 'express';

import { AppError } from '../../middleware/errorHandler';
import { param } from '../../utils/params';

import * as statusChecksService from './status-checks.service';

/**
 * POST /repos/:repoId/statuses
 * @param req
 * @param res
 * @param next
 */
export async function createStatus(req: Request, res: Response, next: NextFunction) {
  try {
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
  } catch (err) {
    next(err);
  }
}

/**
 * GET /repos/:repoId/commits/:sha/statuses
 * @param req
 * @param res
 * @param next
 */
export async function getCommitStatuses(req: Request, res: Response, next: NextFunction) {
  try {
    const combined = await statusChecksService.getCombinedStatus(
      param(req, 'repoId'),
      param(req, 'sha'),
    );
    res.json(combined);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /repos/:repoId/pulls/:number/statuses
 * @param req
 * @param res
 * @param next
 */
export async function getPRStatuses(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await statusChecksService.getStatusesForPR(
      param(req, 'repoId'),
      parseInt(param(req, 'number')),
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}
