import { Request, Response, NextFunction } from 'express';

import { param } from '../../utils/params';

import * as svc from './issue-branches.service';

/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function getBranches(req: Request, res: Response, next: NextFunction) {
  try {
    const projectId = param(req, 'projectId');
    const issueNumber = param(req, 'issueNumber');
    res.json(await svc.getBranches(projectId, parseInt(issueNumber, 10)));
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
export async function createBranch(req: Request, res: Response, next: NextFunction) {
  try {
    const projectId = param(req, 'projectId');
    const issueNumber = param(req, 'issueNumber');
    const branch = await svc.createBranch(projectId, parseInt(issueNumber), req.userId!, req.body);
    res.status(201).json(branch);
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
export async function getSuggestedName(req: Request, res: Response, next: NextFunction) {
  try {
    const projectId = param(req, 'projectId');
    const issueNumber = param(req, 'issueNumber');
    const suggestion = await svc.getSuggestedName(projectId, parseInt(issueNumber, 10));
    res.json({ suggestion });
  } catch (err) {
    next(err);
  }
}
