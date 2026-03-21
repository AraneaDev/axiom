import { Request, Response, NextFunction } from 'express';

import { param } from '../../utils/params';
import { validate, createPageCommentSchema } from '../../utils/validation';

import * as svc from './wiki-comments.service';

/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function addPageComment(req: Request, res: Response, next: NextFunction) {
  try {
    const data = validate(createPageCommentSchema, req.body);
    const comment = await svc.addPageComment(
      param(req, 'pageId'),
      req.userId!,
      data.body,
      data.anchorText,
    );
    res.status(201).json(comment);
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
export async function listPageComments(req: Request, res: Response, next: NextFunction) {
  try {
    const comments = await svc.listPageComments(param(req, 'pageId'));
    res.json(comments);
  } catch (err) {
    next(err);
  }
}

/**
 * Unified PATCH handler for wiki comments: update body or toggle resolved.
 * @param req
 * @param res
 * @param next
 */
export async function patchComment(req: Request, res: Response, next: NextFunction) {
  try {
    const { body } = req.body;
    if (body && typeof body === 'string') {
      const comment = await svc.updatePageComment(param(req, 'commentId'), req.userId!, body);
      res.json(comment);
    } else {
      const comment = await svc.resolveComment(param(req, 'commentId'));
      res.json(comment);
    }
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
export async function deletePageComment(req: Request, res: Response, next: NextFunction) {
  try {
    await svc.deletePageComment(param(req, 'commentId'));
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}
