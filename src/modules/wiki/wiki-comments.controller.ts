import { Request, Response } from 'express';

import { asyncHandler } from '../../utils/asyncHandler';
import { param } from '../../utils/params';
import { validate, createPageCommentSchema } from '../../utils/validation';

import * as svc from './wiki-comments.service';

export const addPageComment = asyncHandler(async (req: Request, res: Response) => {
  const data = validate(createPageCommentSchema, req.body);
  const comment = await svc.addPageComment(
    param(req, 'pageId'),
    req.userId!,
    data.body,
    data.anchorText,
  );
  res.status(201).json(comment);
});

export const listPageComments = asyncHandler(async (req: Request, res: Response) => {
  const comments = await svc.listPageComments(param(req, 'pageId'));
  res.json(comments);
});

export const patchComment = asyncHandler(async (req: Request, res: Response) => {
  const { body } = req.body;
  if (body && typeof body === 'string') {
    const comment = await svc.updatePageComment(param(req, 'commentId'), req.userId!, body);
    res.json(comment);
  } else {
    const comment = await svc.resolveComment(param(req, 'commentId'));
    res.json(comment);
  }
});

export const deletePageComment = asyncHandler(async (req: Request, res: Response) => {
  await svc.deletePageComment(param(req, 'commentId'));
  res.status(204).send();
});

export const toggleReaction = asyncHandler(async (req: Request, res: Response) => {
  const { reactionType } = req.body;
  if (!reactionType || typeof reactionType !== 'string') {
    res.status(400).json({ error: { message: 'reactionType is required' } });
    return;
  }
  const result = await svc.toggleReaction(param(req, 'commentId'), req.userId!, reactionType);
  res.json(result);
});
