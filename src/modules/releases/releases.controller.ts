import { Request, Response, NextFunction } from 'express';

import { AppError } from '../../middleware/errorHandler';
import { param } from '../../utils/params';
import { validate, createReleaseSchema, updateReleaseSchema } from '../../utils/validation';

import * as svc from './releases.service';

/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function listReleases(req: Request, res: Response, next: NextFunction) {
  try {
    const repoId = param(req, 'repoId');
    const draft = req.query.draft !== undefined ? req.query.draft === 'true' : undefined;
    const prerelease =
      req.query.prerelease !== undefined ? req.query.prerelease === 'true' : undefined;
    res.json(await svc.listReleases(repoId, { draft, prerelease }));
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
export async function getRelease(req: Request, res: Response, next: NextFunction) {
  try {
    const repoId = param(req, 'repoId');
    const tagName = param(req, 'tagName');
    const release = await svc.getRelease(repoId, tagName);
    if (!release) {
      throw new AppError(404, 'Release not found');
    }
    res.json(release);
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
export async function createRelease(req: Request, res: Response, next: NextFunction) {
  try {
    const repoId = param(req, 'repoId');
    const body = validate(createReleaseSchema, req.body);
    const release = await svc.createRelease(repoId, req.userId!, body);
    res.status(201).json(release);
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
export async function updateRelease(req: Request, res: Response, next: NextFunction) {
  try {
    const repoId = param(req, 'repoId');
    const tagName = param(req, 'tagName');
    const body = validate(updateReleaseSchema, req.body);
    res.json(await svc.updateRelease(repoId, tagName, body));
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
export async function publishRelease(req: Request, res: Response, next: NextFunction) {
  try {
    const repoId = param(req, 'repoId');
    const tagName = param(req, 'tagName');
    res.json(await svc.publishRelease(repoId, tagName));
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
export async function deleteRelease(req: Request, res: Response, next: NextFunction) {
  try {
    const repoId = param(req, 'repoId');
    const tagName = param(req, 'tagName');
    await svc.deleteRelease(repoId, tagName);
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
export async function compareRelease(req: Request, res: Response, next: NextFunction) {
  try {
    const repoId = param(req, 'repoId');
    const { base, head } = req.query as { base: string; head: string };
    res.json(await svc.compareRelease(repoId, base, head));
  } catch (err) {
    next(err);
  }
}
