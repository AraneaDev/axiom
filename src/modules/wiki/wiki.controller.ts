import { Request, Response } from 'express';

import { asyncHandler } from '../../utils/asyncHandler';
import { param } from '../../utils/params';
import { validate, createWikiSpaceSchema } from '../../utils/validation';

import * as wikiExportService from './wiki-export.service';
import * as wikiService from './wiki.service';

export const createSpace = asyncHandler(async (req: Request, res: Response) => {
  const data = validate(createWikiSpaceSchema, req.body);
  const space = await wikiService.createSpace(param(req, 'teamId'), data);
  res.status(201).json(space);
});

export const updateSpace = asyncHandler(async (req: Request, res: Response) => {
  const space = await wikiService.updateSpace(param(req, 'spaceId'), req.body);
  res.json(space);
});

export const exportPage = asyncHandler(async (req: Request, res: Response) => {
  const format = (req.query.format as string) || 'html';
  await wikiExportService.exportPage(param(req, 'spaceId'), param(req, 'pageSlug'), format, res);
});
