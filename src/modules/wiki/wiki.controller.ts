import { Request, Response, NextFunction } from 'express';

import { param } from '../../utils/params';
import {
  validate,
  createWikiSpaceSchema,
  createPageSchema,
  updatePageSchema,
  movePageSchema,
  copyPageSchema,
} from '../../utils/validation';

import * as wikiExportService from './wiki-export.service';
import * as wikiService from './wiki.service';

/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function createSpace(req: Request, res: Response, next: NextFunction) {
  try {
    const data = validate(createWikiSpaceSchema, req.body);
    const space = await wikiService.createSpace(param(req, 'teamId'), data);
    res.status(201).json(space);
  } catch (err) {
    next(err);
  }
}

/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function getSpace(req: Request, res: Response, next: NextFunction) {
  try {
    const space = await wikiService.getSpace(param(req, 'spaceId'));
    res.json(space);
  } catch (err) {
    next(err);
  }
}

/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function listSpaces(req: Request, res: Response, next: NextFunction) {
  try {
    const spaces = await wikiService.listSpaces(param(req, 'teamId'));
    res.json(spaces);
  } catch (err) {
    next(err);
  }
}

/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function createPage(req: Request, res: Response, next: NextFunction) {
  try {
    const data = validate(createPageSchema, req.body);
    const page = await wikiService.createPage(param(req, 'spaceId'), req.userId!, data);
    res.status(201).json(page);
  } catch (err) {
    next(err);
  }
}

/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function getPage(req: Request, res: Response, next: NextFunction) {
  try {
    const page = await wikiService.getPage(param(req, 'spaceId'), param(req, 'pageSlug'));
    res.json(page);
  } catch (err) {
    next(err);
  }
}

/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function updatePage(req: Request, res: Response, next: NextFunction) {
  try {
    const data = validate(updatePageSchema, req.body);
    const page = await wikiService.updatePage(
      param(req, 'spaceId'),
      param(req, 'pageSlug'),
      req.userId!,
      data,
    );
    res.json(page);
  } catch (err) {
    next(err);
  }
}

/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function deletePage(req: Request, res: Response, next: NextFunction) {
  try {
    await wikiService.deletePage(param(req, 'spaceId'), param(req, 'pageSlug'));
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function pageHistory(req: Request, res: Response, next: NextFunction) {
  try {
    const versions = await wikiService.getPageHistory(
      param(req, 'spaceId'),
      param(req, 'pageSlug'),
    );
    res.json(versions);
  } catch (err) {
    next(err);
  }
}

/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function exportPage(req: Request, res: Response, next: NextFunction) {
  try {
    const format = (req.query.format as string) || 'html';
    await wikiExportService.exportPage(param(req, 'spaceId'), param(req, 'pageSlug'), format, res);
  } catch (err) {
    next(err);
  }
}

/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function pageTree(req: Request, res: Response, next: NextFunction) {
  try {
    const tree = await wikiService.getPageTree(param(req, 'spaceId'));
    res.json(tree);
  } catch (err) {
    next(err);
  }
}

// ─── Page Move / Copy ───────────────────────────────────────

/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function movePage(req: Request, res: Response, next: NextFunction) {
  try {
    const data = validate(movePageSchema, req.body);
    const page = await wikiService.movePage(
      param(req, 'pageId'),
      data.targetSpaceId,
      data.targetParentId,
    );
    res.json(page);
  } catch (err) {
    next(err);
  }
}

/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function copyPage(req: Request, res: Response, next: NextFunction) {
  try {
    const data = validate(copyPageSchema, req.body);
    const page = await wikiService.copyPage(
      param(req, 'pageId'),
      req.userId!,
      data.targetSpaceId,
      data.newSlug,
    );
    res.status(201).json(page);
  } catch (err) {
    next(err);
  }
}
