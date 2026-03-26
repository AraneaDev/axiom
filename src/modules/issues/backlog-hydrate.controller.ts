import { Request, Response } from 'express';

import { asyncHandler } from '../../utils/asyncHandler';
import { param } from '../../utils/params';

import { hydrateBacklog as hydrateBacklogService } from './backlog-hydrate.service';

export const hydrateBacklog = asyncHandler(async (req: Request, res: Response) => {
  const projectId = param(req, 'projectId');
  const result = await hydrateBacklogService(projectId);
  res.json(result);
});
