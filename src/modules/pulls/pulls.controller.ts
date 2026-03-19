import { Request, Response, NextFunction } from 'express';

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

/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const body = validate(createPRSchema, req.body);
    const pr = await pullsService.createPR(param(req, 'repoId'), req.userId!, body);
    res.status(201).json(pr);
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
export async function get(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await pullsService.getPR(param(req, 'repoId'), parseInt(param(req, 'number'), 10)));
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
export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const status = req.query.status as 'OPEN' | 'MERGED' | 'CLOSED' | undefined;
    const { take, skip } = parsePagination(req.query as Record<string, string>);
    res.json(
      await pullsService.listPRs(param(req, 'repoId'), status, { limit: take, offset: skip }),
    );
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
export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const body = validate(updatePRSchema, req.body);
    res.json(
      await pullsService.updatePR(param(req, 'repoId'), parseInt(param(req, 'number'), 10), body),
    );
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
export async function close(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await pullsService.closePR(param(req, 'repoId'), parseInt(param(req, 'number'), 10)));
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
export async function merge(req: Request, res: Response, next: NextFunction) {
  try {
    const body = validate(mergePRSchema, req.body);
    res.json(
      await pullsService.mergePR(
        param(req, 'repoId'),
        parseInt(param(req, 'number'), 10),
        body.strategy,
      ),
    );
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
export async function mergeChecks(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(
      await pullsService.getMergeChecks(param(req, 'repoId'), parseInt(param(req, 'number'), 10)),
    );
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
export async function getDiff(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(
      await pullsService.getPRDiff(param(req, 'repoId'), parseInt(param(req, 'number'), 10)),
    );
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
export async function getCommits(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(
      await pullsService.getPRCommits(param(req, 'repoId'), parseInt(param(req, 'number'), 10)),
    );
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
export async function getLinkedIssues(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(
      await pullsService.getLinkedIssues(param(req, 'repoId'), parseInt(param(req, 'number'), 10)),
    );
  } catch (err) {
    next(err);
  }
}

// Reviews
/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function submitReview(req: Request, res: Response, next: NextFunction) {
  try {
    const body = validate(submitReviewSchema, req.body);
    const review = await pullsService.submitReview(
      param(req, 'repoId'),
      parseInt(param(req, 'number'), 10),
      req.userId!,
      body,
    );
    res.status(201).json(review);
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
export async function listReviews(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(
      await pullsService.listReviews(param(req, 'repoId'), parseInt(param(req, 'number'), 10)),
    );
  } catch (err) {
    next(err);
  }
}

// PR Comments
/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function addComment(req: Request, res: Response, next: NextFunction) {
  try {
    const body = validate(addPRCommentSchema, req.body);
    const comment = await pullsService.addPRComment(
      param(req, 'repoId'),
      parseInt(param(req, 'number'), 10),
      req.userId!,
      body,
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
export async function listComments(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(
      await pullsService.listPRComments(param(req, 'repoId'), parseInt(param(req, 'number'), 10)),
    );
  } catch (err) {
    next(err);
  }
}

// Suggestions
/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function applySuggestion(req: Request, res: Response, next: NextFunction) {
  try {
    const body = validate(applySuggestionSchema, req.body);
    const result = await pullsService.applySuggestion(
      param(req, 'repoId'),
      parseInt(param(req, 'number'), 10),
      body.commentId,
      req.userId!,
    );
    res.json(result);
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
export async function batchApplySuggestions(req: Request, res: Response, next: NextFunction) {
  try {
    const body = validate(batchApplySuggestionsSchema, req.body);
    const result = await pullsService.batchApplySuggestions(
      param(req, 'repoId'),
      parseInt(param(req, 'number'), 10),
      body.commentIds,
      req.userId!,
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}
