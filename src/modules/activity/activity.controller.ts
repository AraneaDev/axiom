import { Request, Response } from 'express';

import { AppError } from '../../middleware/errorHandler';
import { asyncHandler } from '../../utils/asyncHandler';
import { parsePagination } from '../../utils/pagination';
import { param } from '../../utils/params';

import * as activityService from './activity.service';

export const listProjectActivity = asyncHandler(async (req: Request, res: Response) => {
  const projectId = param(req, 'projectId');
  const { take, skip } = parsePagination(req.query as Record<string, string>);
  const result = await activityService.listActivities({
    projectId,
    limit: take,
    offset: skip,
  });
  res.json(result);
});

export const listIssueActivity = asyncHandler(async (req: Request, res: Response) => {
  const projectId = param(req, 'projectId');
  const issueNumber = parseInt(param(req, 'issueNumber'), 10);

  // Resolve issue ID from project + number
  const issueId = await activityService.getIssueIdByNumber(projectId, issueNumber);
  if (!issueId) {
    throw new AppError(404, 'Issue not found');
  }

  const { take, skip } = parsePagination(req.query as Record<string, string>);
  const result = await activityService.listActivities({
    resourceType: 'issue',
    resourceId: issueId,
    limit: take,
    offset: skip,
  });
  res.json(result);
});
