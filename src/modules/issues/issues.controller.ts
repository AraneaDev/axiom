import { Request, Response, NextFunction } from 'express';

import { parsePagination } from '../../utils/pagination';
import { param } from '../../utils/params';
import {
  createIssueSchema,
  updateIssueSchema,
  createCommentSchema,
  logWorkSchema,
  bulkUpdateIssuesSchema,
} from '../../utils/validation';

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
      parseInt(param(req, 'issueNumber'), 10),
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
    const { take, skip } = parsePagination(req.query as Record<string, string>, { limit: 25 });
    const clampedLimit = Math.min(take, 100);
    const result = await issuesService.listIssues(param(req, 'projectId'), {
      q: req.query.q as string,
      type: req.query.type as string,
      priority: req.query.priority as string,
      assigneeId: req.query.assigneeId as string,
      columnId: req.query.columnId as string,
      sprintId: req.query.sprintId as string,
      label: req.query.label as string,
      limit: clampedLimit,
      offset: skip,
    });
    res.json({ ...result, limit: clampedLimit, offset: skip });
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
      parseInt(param(req, 'issueNumber'), 10),
      data,
      req.userId!,
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
    await issuesService.deleteIssue(
      param(req, 'projectId'),
      parseInt(param(req, 'issueNumber'), 10),
      req.userId!,
    );
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
    const parsed = createCommentSchema.parse(req.body);
    const commentBody = String(parsed.body);
    const issue = await issuesService.getIssue(
      param(req, 'projectId'),
      parseInt(param(req, 'issueNumber'), 10),
    );
    const comment = await issuesService.addComment(issue.id, req.userId!, commentBody);
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
export async function updateComment(req: Request, res: Response, next: NextFunction) {
  try {
    const { body } = req.body;
    if (!body || typeof body !== 'string') {
      res.status(400).json({ error: { message: 'body is required' } });
      return;
    }
    const comment = await issuesService.updateComment(param(req, 'commentId'), req.userId!, body);
    res.json(comment);
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
export async function deleteComment(req: Request, res: Response, next: NextFunction) {
  try {
    await issuesService.deleteComment(param(req, 'commentId'), req.userId!);
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
export async function board(req: Request, res: Response, next: NextFunction) {
  try {
    const columns = await issuesService.getBoard(param(req, 'projectId'));
    res.json(columns);
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
export async function listPullRequests(req: Request, res: Response, next: NextFunction) {
  try {
    const prs = await issuesService.getIssuePullRequests(
      param(req, 'projectId'),
      parseInt(param(req, 'issueNumber'), 10),
    );
    res.json(prs);
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
export async function moveIssue(req: Request, res: Response, next: NextFunction) {
  try {
    const { columnId, position } = req.body;
    const issue = await issuesService.moveIssue(
      param(req, 'projectId'),
      parseInt(param(req, 'issueNumber'), 10),
      columnId,
      position,
    );
    res.json(issue);
  } catch (err) {
    next(err);
  }
}

/**
 * Set parent issue (epic hierarchy).
 * @param req
 * @param res
 * @param next
 */
export async function setParent(req: Request, res: Response, next: NextFunction) {
  try {
    const { parentIssueNumber } = req.body;
    const issue = await issuesService.setParent(
      param(req, 'projectId'),
      parseInt(param(req, 'issueNumber'), 10),
      parentIssueNumber !== undefined && parentIssueNumber !== null
        ? parseInt(parentIssueNumber, 10)
        : null,
    );
    res.json(issue);
  } catch (err) {
    next(err);
  }
}

/**
 * Get child issues.
 * @param req
 * @param res
 * @param next
 */
export async function getChildren(req: Request, res: Response, next: NextFunction) {
  try {
    const children = await issuesService.getChildren(
      param(req, 'projectId'),
      parseInt(param(req, 'issueNumber'), 10),
    );
    res.json(children);
  } catch (err) {
    next(err);
  }
}

/**
 * Get epic progress stats.
 * @param req
 * @param res
 * @param next
 */
export async function getProgress(req: Request, res: Response, next: NextFunction) {
  try {
    const progress = await issuesService.getEpicProgress(
      param(req, 'projectId'),
      parseInt(param(req, 'issueNumber'), 10),
    );
    res.json(progress);
  } catch (err) {
    next(err);
  }
}

/**
 * Get roadmap data for a project.
 * @param req
 * @param res
 * @param next
 */
export async function roadmap(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await issuesService.getRoadmap(param(req, 'projectId'));
    res.json(data);
  } catch (err) {
    next(err);
  }
}

/**
 * Log work on an issue.
 * @param req
 * @param res
 * @param next
 */
export async function logWork(req: Request, res: Response, next: NextFunction) {
  try {
    const data = logWorkSchema.parse(req.body);
    const result = await issuesService.logWork(
      param(req, 'projectId'),
      parseInt(param(req, 'issueNumber'), 10),
      req.userId!,
      data.minutes,
      data.description,
    );
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * Get work logs for an issue.
 * @param req
 * @param res
 * @param next
 */
export async function getWorklogs(req: Request, res: Response, next: NextFunction) {
  try {
    const worklogs = await issuesService.getWorklogs(
      param(req, 'projectId'),
      parseInt(param(req, 'issueNumber'), 10),
    );
    res.json(worklogs);
  } catch (err) {
    next(err);
  }
}

/**
 * Bulk update multiple issues.
 * @param req
 * @param res
 * @param next
 */
export async function bulkUpdate(req: Request, res: Response, next: NextFunction) {
  try {
    const data = bulkUpdateIssuesSchema.parse(req.body);
    const result = await issuesService.bulkUpdate(
      param(req, 'projectId'),
      data.issueIds,
      data.updates,
      req.userId!,
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * Get time report for a project.
 * @param req
 * @param res
 * @param next
 */
export async function getTimeReport(req: Request, res: Response, next: NextFunction) {
  try {
    const report = await issuesService.getTimeReport(param(req, 'projectId'));
    res.json(report);
  } catch (err) {
    next(err);
  }
}

/**
 * Export issues as CSV.
 * @param req
 * @param res
 * @param next
 */
export async function exportCsv(req: Request, res: Response, next: NextFunction) {
  try {
    const csv = await issuesService.exportIssuesCsv(param(req, 'projectId'));
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="issues.csv"');
    res.send(csv);
  } catch (err) {
    next(err);
  }
}
