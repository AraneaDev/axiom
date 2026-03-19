import { Request, Response, NextFunction } from 'express';

import { param } from '../../utils/params';

import * as svc from './issue-commits.service';

/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function getCommits(req: Request, res: Response, next: NextFunction) {
  try {
    const projectId = param(req, 'projectId');
    const issueNumber = param(req, 'issueNumber');
    res.json(await svc.getCommits(projectId, parseInt(issueNumber, 10)));
  } catch (err) {
    next(err);
  }
}
