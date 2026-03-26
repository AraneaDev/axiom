import { Request, Response, NextFunction } from 'express';

import { param } from '../../utils/params';

import { hydrateWikiPage as hydrateWikiPageService } from './wiki-hydrate.service';

/**
 * Controller for the Wiki Page hydration endpoint.
 * @param req - Express request
 * @param res - Express response
 * @param next - Express next function
 */
export async function hydrateWikiPage(req: Request, res: Response, next: NextFunction) {
  try {
    const spaceId = param(req, 'spaceId');
    const pageSlug = param(req, 'pageSlug');
    const result = await hydrateWikiPageService(spaceId, pageSlug);
    res.json(result);
  } catch (err) {
    next(err);
  }
}
