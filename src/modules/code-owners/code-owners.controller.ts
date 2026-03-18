import { Request, Response, NextFunction } from 'express';

import { param } from '../../utils/params';

import * as codeOwnersService from './code-owners.service';

/**
 * GET /repos/:repoId/pulls/:number/code-owners
 * @param req
 * @param res
 * @param next
 */
export async function getPROwners(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await codeOwnersService.getOwnersForPR(
      param(req, 'repoId'),
      parseInt(param(req, 'number')),
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}
