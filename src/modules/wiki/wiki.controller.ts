import { Request, Response } from 'express';

import { asyncHandler } from '../../utils/asyncHandler';
import { param } from '../../utils/params';
import {
  validate,
  createWikiSpaceSchema,
  createPageSchema,
  updatePageSchema,
  movePageSchema,
  copyPageSchema,
  restoreVersionSchema,
} from '../../utils/validation';

import * as wikiExportService from './wiki-export.service';
import * as wikiService from './wiki.service';

export const createSpace = asyncHandler(async (req: Request, res: Response) => {
  const data = validate(createWikiSpaceSchema, req.body);
  const space = await wikiService.createSpace(param(req, 'teamId'), data);
  res.status(201).json(space);
});

export const getSpace = asyncHandler(async (req: Request, res: Response) => {
  const space = await wikiService.getSpace(param(req, 'spaceId'));
  res.json(space);
});

export const listSpaces = asyncHandler(async (req: Request, res: Response) => {
  const includeArchived = req.query.includeArchived === 'true';
  const spaces = await wikiService.listSpaces(param(req, 'teamId'), includeArchived);
  res.json(spaces);
});

export const updateSpace = asyncHandler(async (req: Request, res: Response) => {
  const space = await wikiService.updateSpace(param(req, 'spaceId'), req.body);
  res.json(space);
});

export const createPage = asyncHandler(async (req: Request, res: Response) => {
  const data = validate(createPageSchema, req.body);
  const page = await wikiService.createPage(param(req, 'spaceId'), req.userId!, data);
  res.status(201).json(page);
});

export const getPage = asyncHandler(async (req: Request, res: Response) => {
  const page = await wikiService.getPage(param(req, 'spaceId'), param(req, 'pageSlug'), req.userId);
  res.json(page);
});

export const updatePage = asyncHandler(async (req: Request, res: Response) => {
  const data = validate(updatePageSchema, req.body);
  const page = await wikiService.updatePage(
    param(req, 'spaceId'),
    param(req, 'pageSlug'),
    req.userId!,
    data,
  );
  res.json(page);
});

export const deletePage = asyncHandler(async (req: Request, res: Response) => {
  await wikiService.deletePage(param(req, 'spaceId'), param(req, 'pageSlug'), req.userId);
  res.status(204).send();
});

export const pageHistory = asyncHandler(async (req: Request, res: Response) => {
  const versions = await wikiService.getPageHistory(param(req, 'spaceId'), param(req, 'pageSlug'));
  res.json(versions);
});

export const exportPage = asyncHandler(async (req: Request, res: Response) => {
  const format = (req.query.format as string) || 'html';
  await wikiExportService.exportPage(param(req, 'spaceId'), param(req, 'pageSlug'), format, res);
});

export const pageTree = asyncHandler(async (req: Request, res: Response) => {
  const tree = await wikiService.getPageTree(param(req, 'spaceId'));
  res.json(tree);
});

// Version Comparison & Restore

export const diffVersions = asyncHandler(async (req: Request, res: Response) => {
  const from = parseInt(req.query.from as string, 10);
  const to = parseInt(req.query.to as string, 10);
  if (isNaN(from) || isNaN(to)) {
    res
      .status(400)
      .json({ error: { message: 'Both "from" and "to" query params are required as integers' } });
    return;
  }
  const result = await wikiService.diffVersions(
    param(req, 'spaceId'),
    param(req, 'pageSlug'),
    from,
    to,
  );
  res.json(result);
});

export const restoreVersion = asyncHandler(async (req: Request, res: Response) => {
  const data = validate(restoreVersionSchema, req.body);
  const page = await wikiService.restoreVersion(
    param(req, 'spaceId'),
    param(req, 'pageSlug'),
    data.version,
    req.userId!,
  );
  res.json(page);
});

// Page Move / Copy

export const movePage = asyncHandler(async (req: Request, res: Response) => {
  const data = validate(movePageSchema, req.body);
  const page = await wikiService.movePage(
    param(req, 'pageId'),
    data.targetSpaceId,
    data.targetParentId,
  );
  res.json(page);
});

export const copyPage = asyncHandler(async (req: Request, res: Response) => {
  const data = validate(copyPageSchema, req.body);
  const page = await wikiService.copyPage(
    param(req, 'pageId'),
    req.userId!,
    data.targetSpaceId,
    data.newSlug,
  );
  res.status(201).json(page);
});
