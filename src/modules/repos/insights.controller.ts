import { Request, Response, NextFunction } from 'express';

import { param } from '../../utils/params';

import * as insightsService from './insights.service';

/**
 * GET /repos/:repoId/insights/commit-frequency
 * @param req
 * @param res
 * @param next
 */
export async function commitFrequency(req: Request, res: Response, next: NextFunction) {
  try {
    const days = parseInt((req.query.days as string) || '90', 10);
    const data = await insightsService.getCommitFrequency(param(req, 'repoId'), days);
    res.json(data);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /repos/:repoId/insights/contributors
 * @param req
 * @param res
 * @param next
 */
export async function contributors(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await insightsService.getContributors(param(req, 'repoId'));
    res.json(data);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /repos/:repoId/insights/languages
 * @param req
 * @param res
 * @param next
 */
export async function languages(req: Request, res: Response, next: NextFunction) {
  try {
    const ref = (req.query.ref as string) || 'HEAD';
    const data = await insightsService.getLanguageBreakdown(param(req, 'repoId'), ref);
    res.json(data);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /repos/:repoId/insights/code-frequency
 * @param req
 * @param res
 * @param next
 */
export async function codeFrequency(req: Request, res: Response, next: NextFunction) {
  try {
    const weeks = parseInt((req.query.weeks as string) || '52', 10);
    const data = await insightsService.getCodeFrequency(param(req, 'repoId'), weeks);
    res.json(data);
  } catch (err) {
    next(err);
  }
}
