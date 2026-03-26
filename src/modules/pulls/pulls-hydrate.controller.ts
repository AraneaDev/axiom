import { Request, Response, NextFunction } from 'express';

import { param } from '../../utils/params';

import { hydratePRDetail as hydratePRDetailService } from './pulls-hydrate.service';

/**
 * Controller for the PR Detail hydration endpoint.
 * @param req - Express request
 * @param res - Express response
 * @param next - Express next function
 */
export async function hydratePRDetail(req: Request, res: Response, next: NextFunction) {
  try {
    const repoId = param(req, 'repoId');
    const prNumber = parseInt(param(req, 'number'), 10);
    const result = await hydratePRDetailService(repoId, prNumber);
    res.json(result);
  } catch (err) {
    next(err);
  }
}
