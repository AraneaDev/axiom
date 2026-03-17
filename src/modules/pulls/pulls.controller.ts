import { Request, Response, NextFunction } from 'express';
import * as pullsService from './pulls.service';
import { param } from '../../utils/params';

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const pr = await pullsService.createPR(param(req, 'repoId'), req.userId!, req.body);
    res.status(201).json(pr);
  } catch (err) { next(err); }
}

export async function get(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await pullsService.getPR(param(req, 'repoId'), parseInt(param(req, 'number'))));
  } catch (err) { next(err); }
}

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const status = req.query.status as 'OPEN' | 'MERGED' | 'CLOSED' | undefined;
    res.json(await pullsService.listPRs(param(req, 'repoId'), status));
  } catch (err) { next(err); }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await pullsService.updatePR(param(req, 'repoId'), parseInt(param(req, 'number')), req.body));
  } catch (err) { next(err); }
}

export async function close(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await pullsService.closePR(param(req, 'repoId'), parseInt(param(req, 'number'))));
  } catch (err) { next(err); }
}

export async function merge(req: Request, res: Response, next: NextFunction) {
  try {
    const strategy = req.body.strategy || 'merge';
    res.json(await pullsService.mergePR(param(req, 'repoId'), parseInt(param(req, 'number')), strategy));
  } catch (err) { next(err); }
}

export async function getDiff(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await pullsService.getPRDiff(param(req, 'repoId'), parseInt(param(req, 'number'))));
  } catch (err) { next(err); }
}

export async function getCommits(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await pullsService.getPRCommits(param(req, 'repoId'), parseInt(param(req, 'number'))));
  } catch (err) { next(err); }
}

export async function getLinkedIssues(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await pullsService.getLinkedIssues(param(req, 'repoId'), parseInt(param(req, 'number'))));
  } catch (err) { next(err); }
}

// Reviews
export async function submitReview(req: Request, res: Response, next: NextFunction) {
  try {
    const review = await pullsService.submitReview(param(req, 'repoId'), parseInt(param(req, 'number')), req.userId!, req.body);
    res.status(201).json(review);
  } catch (err) { next(err); }
}

export async function listReviews(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await pullsService.listReviews(param(req, 'repoId'), parseInt(param(req, 'number'))));
  } catch (err) { next(err); }
}

// PR Comments
export async function addComment(req: Request, res: Response, next: NextFunction) {
  try {
    const comment = await pullsService.addPRComment(param(req, 'repoId'), parseInt(param(req, 'number')), req.userId!, req.body);
    res.status(201).json(comment);
  } catch (err) { next(err); }
}

export async function listComments(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await pullsService.listPRComments(param(req, 'repoId'), parseInt(param(req, 'number'))));
  } catch (err) { next(err); }
}
