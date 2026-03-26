import { Request, Response, NextFunction } from 'express';

import { param } from '../../utils/params';

import { hydrateBacklog as hydrateBacklogService } from './backlog-hydrate.service';

/**
 * Controller for the Backlog hydration endpoint.
 */
export async function hydrateBacklog(req: Request, res: Response, next: NextFunction) {
  try {
    const projectId = param(req, 'projectId');
    const result = await hydrateBacklogService(projectId);
    res.json(result);
  } catch (err) {
    next(err);
  }
}
