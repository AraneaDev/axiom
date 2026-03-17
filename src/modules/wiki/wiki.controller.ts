import { Request, Response, NextFunction } from 'express';
import * as wikiService from './wiki.service';
import { createWikiSpaceSchema, createPageSchema, updatePageSchema } from '../../utils/validation';
import { param } from '../../utils/params';

export async function createSpace(req: Request, res: Response, next: NextFunction) {
  try {
    const data = createWikiSpaceSchema.parse(req.body);
    const space = await wikiService.createSpace(param(req, 'teamId'), data);
    res.status(201).json(space);
  } catch (err) {
    next(err);
  }
}

export async function getSpace(req: Request, res: Response, next: NextFunction) {
  try {
    const space = await wikiService.getSpace(param(req, 'spaceId'));
    res.json(space);
  } catch (err) {
    next(err);
  }
}

export async function listSpaces(req: Request, res: Response, next: NextFunction) {
  try {
    const spaces = await wikiService.listSpaces(param(req, 'teamId'));
    res.json(spaces);
  } catch (err) {
    next(err);
  }
}

export async function createPage(req: Request, res: Response, next: NextFunction) {
  try {
    const data = createPageSchema.parse(req.body);
    const page = await wikiService.createPage(param(req, 'spaceId'), req.userId!, data);
    res.status(201).json(page);
  } catch (err) {
    next(err);
  }
}

export async function getPage(req: Request, res: Response, next: NextFunction) {
  try {
    const page = await wikiService.getPage(param(req, 'spaceId'), param(req, 'pageSlug'));
    res.json(page);
  } catch (err) {
    next(err);
  }
}

export async function updatePage(req: Request, res: Response, next: NextFunction) {
  try {
    const data = updatePageSchema.parse(req.body);
    const page = await wikiService.updatePage(param(req, 'spaceId'), param(req, 'pageSlug'), req.userId!, data);
    res.json(page);
  } catch (err) {
    next(err);
  }
}

export async function deletePage(req: Request, res: Response, next: NextFunction) {
  try {
    await wikiService.deletePage(param(req, 'spaceId'), param(req, 'pageSlug'));
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

export async function pageHistory(req: Request, res: Response, next: NextFunction) {
  try {
    const versions = await wikiService.getPageHistory(param(req, 'spaceId'), param(req, 'pageSlug'));
    res.json(versions);
  } catch (err) {
    next(err);
  }
}

export async function pageTree(req: Request, res: Response, next: NextFunction) {
  try {
    const tree = await wikiService.getPageTree(param(req, 'spaceId'));
    res.json(tree);
  } catch (err) {
    next(err);
  }
}
