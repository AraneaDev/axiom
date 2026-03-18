import { Request, Response, NextFunction } from 'express';

import { param } from '../../utils/params';

import * as pullsService from './pulls.service';

/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const pr = await pullsService.createPR(param(req, 'repoId'), req.userId!, req.body);
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
    res.json(await pullsService.getPR(param(req, 'repoId'), parseInt(param(req, 'number'))));
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
    res.json(await pullsService.listPRs(param(req, 'repoId'), status));
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
    res.json(
      await pullsService.updatePR(param(req, 'repoId'), parseInt(param(req, 'number')), req.body),
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
    res.json(await pullsService.closePR(param(req, 'repoId'), parseInt(param(req, 'number'))));
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
    const strategy = req.body.strategy || 'merge';
    res.json(
      await pullsService.mergePR(param(req, 'repoId'), parseInt(param(req, 'number')), strategy),
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
    res.json(await pullsService.getPRDiff(param(req, 'repoId'), parseInt(param(req, 'number'))));
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
    res.json(await pullsService.getPRCommits(param(req, 'repoId'), parseInt(param(req, 'number'))));
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
      await pullsService.getLinkedIssues(param(req, 'repoId'), parseInt(param(req, 'number'))),
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
    const review = await pullsService.submitReview(
      param(req, 'repoId'),
      parseInt(param(req, 'number')),
      req.userId!,
      req.body,
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
    res.json(await pullsService.listReviews(param(req, 'repoId'), parseInt(param(req, 'number'))));
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
    const comment = await pullsService.addPRComment(
      param(req, 'repoId'),
      parseInt(param(req, 'number')),
      req.userId!,
      req.body,
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
      await pullsService.listPRComments(param(req, 'repoId'), parseInt(param(req, 'number'))),
    );
  } catch (err) {
    next(err);
  }
}
