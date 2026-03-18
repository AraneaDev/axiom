import { Request, Response, NextFunction } from 'express';

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
    const result = await activityService.listActivities({
      projectId,
      limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
      offset: req.query.offset ? parseInt(req.query.offset as string) : undefined,
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
    const issueNumber = parseInt(param(req, 'issueNumber'));

    // Resolve issue ID from project + number
    const { prisma } = await import('../../config/database');
    const issue = await prisma.issue.findUnique({
      where: { projectId_number: { projectId, number: issueNumber } },
    });
    if (!issue) {
      res.status(404).json({ error: { message: 'Issue not found' } });
      return;
    }

    const result = await activityService.listActivities({
      resourceType: 'issue',
      resourceId: issue.id,
      limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
      offset: req.query.offset ? parseInt(req.query.offset as string) : undefined,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
}
