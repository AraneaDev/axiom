import { Request, Response, NextFunction } from 'express';

import { param } from '../../utils/params';

import * as svc from './issue-votes.service';

/**
 * Toggle the current user's vote on an issue.
 * @param req
 * @param res
 * @param next
 */
export async function toggle(req: Request, res: Response, next: NextFunction) {
  try {
    const projectId = param(req, 'projectId');
    const issueNumber = param(req, 'issueNumber');
    const result = await svc.toggleVote(projectId, parseInt(issueNumber, 10), req.userId!);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * Get vote count and whether the current user has voted.
 * @param req
 * @param res
 * @param next
 */
export async function getVotes(req: Request, res: Response, next: NextFunction) {
  try {
    const projectId = param(req, 'projectId');
    const issueNumber = param(req, 'issueNumber');
    const result = await svc.getVotes(projectId, parseInt(issueNumber, 10), req.userId!);
    res.json(result);
  } catch (err) {
    next(err);
  }
}
