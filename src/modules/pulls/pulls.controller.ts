import { Request, Response } from 'express';

import { AppError } from '../../middleware/errorHandler';
import { asyncHandler } from '../../utils/asyncHandler';
import { parsePagination } from '../../utils/pagination';
import { param } from '../../utils/params';
import {
  validate,
  createPRSchema,
  updatePRSchema,
  mergePRSchema,
  submitReviewSchema,
  addPRCommentSchema,
  applySuggestionSchema,
  batchApplySuggestionsSchema,
} from '../../utils/validation';

import * as pullsService from './pulls.service';

export const create = asyncHandler(async (req: Request, res: Response) => {
  const body = validate(createPRSchema, req.body);
  const pr = await pullsService.createPR(param(req, 'repoId'), req.userId!, body);
  res.status(201).json(pr);
});

export const get = asyncHandler(async (req: Request, res: Response) => {
  res.json(await pullsService.getPR(param(req, 'repoId'), parseInt(param(req, 'number'), 10)));
});

export const list = asyncHandler(async (req: Request, res: Response) => {
  const status = req.query.status as 'OPEN' | 'MERGED' | 'CLOSED' | undefined;
  const reviewerId = req.query.reviewerId as string | undefined;
  const { take, skip } = parsePagination(req.query as Record<string, string>);
  res.json(
    await pullsService.listPRs(param(req, 'repoId'), status, {
      limit: take,
      offset: skip,
      reviewerId,
    }),
  );
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const body = validate(updatePRSchema, req.body);
  res.json(
    await pullsService.updatePR(param(req, 'repoId'), parseInt(param(req, 'number'), 10), body),
  );
});

export const close = asyncHandler(async (req: Request, res: Response) => {
  res.json(await pullsService.closePR(param(req, 'repoId'), parseInt(param(req, 'number'), 10)));
});

export const merge = asyncHandler(async (req: Request, res: Response) => {
  const body = validate(mergePRSchema, req.body);
  res.json(
    await pullsService.mergePR(
      param(req, 'repoId'),
      parseInt(param(req, 'number'), 10),
      body.strategy,
    ),
  );
});

export const mergeChecks = asyncHandler(async (req: Request, res: Response) => {
  res.json(
    await pullsService.getMergeChecks(param(req, 'repoId'), parseInt(param(req, 'number'), 10)),
  );
});

export const getDiff = asyncHandler(async (req: Request, res: Response) => {
  res.json(await pullsService.getPRDiff(param(req, 'repoId'), parseInt(param(req, 'number'), 10)));
});

export const getCommits = asyncHandler(async (req: Request, res: Response) => {
  res.json(
    await pullsService.getPRCommits(param(req, 'repoId'), parseInt(param(req, 'number'), 10)),
  );
});

export const getLinkedIssues = asyncHandler(async (req: Request, res: Response) => {
  res.json(
    await pullsService.getLinkedIssues(param(req, 'repoId'), parseInt(param(req, 'number'), 10)),
  );
});

// Reviews
export const submitReview = asyncHandler(async (req: Request, res: Response) => {
  const body = validate(submitReviewSchema, req.body);
  const review = await pullsService.submitReview(
    param(req, 'repoId'),
    parseInt(param(req, 'number'), 10),
    req.userId!,
    body,
  );
  res.status(201).json(review);
});

export const listReviews = asyncHandler(async (req: Request, res: Response) => {
  res.json(
    await pullsService.listReviews(param(req, 'repoId'), parseInt(param(req, 'number'), 10)),
  );
});

// PR Comments
export const addComment = asyncHandler(async (req: Request, res: Response) => {
  const body = validate(addPRCommentSchema, req.body);
  const comment = await pullsService.addPRComment(
    param(req, 'repoId'),
    parseInt(param(req, 'number'), 10),
    req.userId!,
    body,
  );
  res.status(201).json(comment);
});

export const listComments = asyncHandler(async (req: Request, res: Response) => {
  res.json(
    await pullsService.listPRComments(param(req, 'repoId'), parseInt(param(req, 'number'), 10)),
  );
});

export const updateComment = asyncHandler(async (req: Request, res: Response) => {
  const { body } = req.body;
  if (!body || typeof body !== 'string') {
    throw new AppError(400, 'body is required');
  }
  const comment = await pullsService.updatePRComment(param(req, 'commentId'), req.userId!, body);
  res.json(comment);
});

export const deleteComment = asyncHandler(async (req: Request, res: Response) => {
  await pullsService.deletePRComment(param(req, 'commentId'), req.userId!);
  res.status(204).send();
});

// Suggestions
export const applySuggestion = asyncHandler(async (req: Request, res: Response) => {
  const body = validate(applySuggestionSchema, req.body);
  const result = await pullsService.applySuggestion(
    param(req, 'repoId'),
    parseInt(param(req, 'number'), 10),
    body.commentId,
    req.userId!,
  );
  res.json(result);
});

export const batchApplySuggestions = asyncHandler(async (req: Request, res: Response) => {
  const body = validate(batchApplySuggestionsSchema, req.body);
  const result = await pullsService.batchApplySuggestions(
    param(req, 'repoId'),
    parseInt(param(req, 'number'), 10),
    body.commentIds,
    req.userId!,
  );
  res.json(result);
});
