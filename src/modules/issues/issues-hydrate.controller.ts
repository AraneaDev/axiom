import { Request, Response, NextFunction } from 'express';

import { param } from '../../utils/params';

import { hydrateIssueDetail as hydrateIssueDetailService } from './issues-hydrate.service';

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
