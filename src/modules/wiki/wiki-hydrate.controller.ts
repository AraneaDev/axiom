import { Request, Response } from 'express';

import { AppError } from '../../middleware/errorHandler';
import { asyncHandler } from '../../utils/asyncHandler';
import { param } from '../../utils/params';

import { hydrateWikiPage as hydrateWikiPageService } from './wiki-hydrate.service';

export const hydrateWikiPage = asyncHandler(async (req: Request, res: Response) => {
  if (!req.userId) throw new AppError(401, 'Authentication required', 'AUTH_REQUIRED');
  const spaceId = param(req, 'spaceId');
  const pageSlug = param(req, 'pageSlug');
  const result = await hydrateWikiPageService(spaceId, pageSlug, req.userId);
  res.json(result);
});
