import { Request, Response, NextFunction } from 'express';

import { param } from '../../utils/params';

import * as svc from './issue-watchers.service';

/**
 * Toggle watch/unwatch for the current user on an issue.
 * @param req
 * @param res
 * @param next
 */
export async function toggleWatch(req: Request, res: Response, next: NextFunction) {
  try {
    const projectId = param(req, 'projectId');
    const issueNumber = param(req, 'issueNumber');
    const result = await svc.toggleWatch(projectId, parseInt(issueNumber, 10), req.userId!);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * Get all watchers for an issue, including whether the current user is watching.
 * @param req
 * @param res
 * @param next
 */
export async function getWatchers(req: Request, res: Response, next: NextFunction) {
  try {
    const projectId = param(req, 'projectId');
    const issueNumber = param(req, 'issueNumber');
    const watchers = await svc.getWatchers(projectId, parseInt(issueNumber, 10));
    const watching = await svc.isWatching(projectId, parseInt(issueNumber, 10), req.userId!);
    res.json({ watchers, watching });
  } catch (err) {
    next(err);
  }
}
