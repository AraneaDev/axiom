import { Request, Response, NextFunction } from 'express';

import { parsePagination } from '../../utils/pagination';
import { param } from '../../utils/params';

import * as activityService from './activity.service';

/**
 * GET /projects/:projectId/activity
 * @param req
 * @param res
 * @param next
 */
export async function listProjectActivity(req: Request, res: Response, next: NextFunction) {
  try {
    const projectId = param(req, 'projectId');
    const { take, skip } = parsePagination(req.query as Record<string, string>);
    const result = await activityService.listActivities({
      projectId,
      limit: take,
      offset: skip,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /projects/:projectId/issues/:issueNumber/activity
 * @param req
 * @param res
 * @param next
 */
export async function listIssueActivity(req: Request, res: Response, next: NextFunction) {
  try {
    const projectId = param(req, 'projectId');
    const issueNumber = parseInt(param(req, 'issueNumber'), 10);

    // Resolve issue ID from project + number
    const issueId = await activityService.getIssueIdByNumber(projectId, issueNumber);
    if (!issueId) {
      res.status(404).json({ error: { message: 'Issue not found' } });
      return;
    }

    const { take, skip } = parsePagination(req.query as Record<string, string>);
    const result = await activityService.listActivities({
      resourceType: 'issue',
      resourceId: issueId,
      limit: take,
      offset: skip,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
}
