import { Request, Response } from 'express';

import { asyncHandler } from '../../utils/asyncHandler';
import { param } from '../../utils/params';

import { hydrateWikiPage as hydrateWikiPageService } from './wiki-hydrate.service';

export const hydrateWikiPage = asyncHandler(async (req: Request, res: Response) => {
  const spaceId = param(req, 'spaceId');
  const pageSlug = param(req, 'pageSlug');
  const result = await hydrateWikiPageService(spaceId, pageSlug);
  res.json(result);
});
