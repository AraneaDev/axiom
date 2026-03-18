import { Request, Response, NextFunction } from 'express';

import { param } from '../../utils/params';
import { createIssueSchema, updateIssueSchema, createCommentSchema } from '../../utils/validation';

import * as issuesService from './issues.service';

/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const data = createIssueSchema.parse(req.body);
    const issue = await issuesService.createIssue(param(req, 'projectId'), req.userId!, data);
    res.status(201).json(issue);
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
    const issue = await issuesService.getIssue(
      param(req, 'projectId'),
      parseInt(param(req, 'issueNumber')),
    );
    res.json(issue);
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
    const result = await issuesService.listIssues(param(req, 'projectId'), {
      type: req.query.type as string,
      priority: req.query.priority as string,
      assigneeId: req.query.assigneeId as string,
      columnId: req.query.columnId as string,
      label: req.query.label as string,
      limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
      offset: req.query.offset ? parseInt(req.query.offset as string) : undefined,
    });
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
export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const data = updateIssueSchema.parse(req.body);
    const issue = await issuesService.updateIssue(
      param(req, 'projectId'),
      parseInt(param(req, 'issueNumber')),
      data,
    );
    res.json(issue);
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
export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    await issuesService.deleteIssue(param(req, 'projectId'), parseInt(param(req, 'issueNumber')));
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
export async function addComment(req: Request, res: Response, next: NextFunction) {
  try {
    const { body } = createCommentSchema.parse(req.body);
    const issue = await issuesService.getIssue(
      param(req, 'projectId'),
      parseInt(param(req, 'issueNumber')),
    );
    const comment = await issuesService.addComment(issue.id, req.userId!, body);
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
export async function board(req: Request, res: Response, next: NextFunction) {
  try {
    const columns = await issuesService.getBoard(param(req, 'projectId'));
    res.json(columns);
  } catch (err) {
    next(err);
  }
}
