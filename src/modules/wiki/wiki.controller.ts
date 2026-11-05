import { Request, Response } from 'express';

import { asyncHandler } from '../../utils/asyncHandler';
import { param } from '../../utils/params';

import * as wikiExportService from './wiki-export.service';

export const exportPage = asyncHandler(async (req: Request, res: Response) => {
  const format = (req.query.format as string) || 'html';
  await wikiExportService.exportPage(param(req, 'spaceId'), param(req, 'pageSlug'), format, res);
});
