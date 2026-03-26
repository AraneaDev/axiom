import { Request, Response, NextFunction } from 'express';

import { param } from '../../utils/params';

import {
  hydrateIssueDetail as hydrateIssueDetailService,
  hydrateIssuesList as hydrateIssuesListService,
} from './issues-hydrate.service';

/**
 * Controller for the Issue Detail hydration endpoint.
 * @param req - Express request
 * @param res - Express response
 * @param next - Express next function
 */
export async function hydrateIssueDetail(req: Request, res: Response, next: NextFunction) {
  try {
    const projectId = param(req, 'projectId');
    const issueNumber = parseInt(param(req, 'issueNumber'), 10);
    const result = await hydrateIssueDetailService(projectId, issueNumber, req.userId!);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * Controller for the Issues List hydration endpoint.
 */
export async function hydrateIssuesList(req: Request, res: Response, next: NextFunction) {
  try {
    const projectId = param(req, 'projectId');
    const filters: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.query)) {
      if (typeof v === 'string') filters[k] = v;
    }
    const result = await hydrateIssuesListService(projectId, filters, req.userId!);
    res.json(result);
  } catch (err) {
    next(err);
  }
}
