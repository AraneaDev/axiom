import { Request, Response } from 'express';

import { AppError } from '../../middleware/errorHandler';
import { asyncHandler } from '../../utils/asyncHandler';
import { parseServicePagination } from '../../utils/pagination';
import { param, paramInt } from '../../utils/params';
import {
  validate,
  createIssueSchema,
  updateIssueSchema,
  issueListQuerySchema,
  createCommentSchema,
  logWorkSchema,
  bulkUpdateIssuesSchema,
} from '../../utils/validation';

import * as issuesService from './issues.service';

export const create = asyncHandler(async (req: Request, res: Response) => {
  const data = validate(createIssueSchema, req.body);
  const issue = await issuesService.createIssue(param(req, 'projectId'), req.userId!, data);
  res.status(201).json(issue);
});

export const get = asyncHandler(async (req: Request, res: Response) => {
  const issue = await issuesService.getIssue(param(req, 'projectId'), paramInt(req, 'issueNumber'));
  res.json(issue);
});

export const list = asyncHandler(async (req: Request, res: Response) => {
  const query = validate(issueListQuerySchema, req.query);
  const { take, skip } = parseServicePagination({ limit: query.limit, offset: query.offset }, 25);
  const result = await issuesService.listIssues(param(req, 'projectId'), {
    q: query.q,
    type: query.type,
    priority: query.priority,
    assigneeId: query.assigneeId,
    columnId: query.columnId,
    sprintId: query.sprintId,
    label: query.label,
    limit: take,
    offset: skip,
  });
  res.json({ ...result, limit: take, offset: skip });
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const data = validate(updateIssueSchema, req.body);
  const issue = await issuesService.updateIssue(
    param(req, 'projectId'),
    paramInt(req, 'issueNumber'),
    data,
    req.userId!,
  );
  res.json(issue);
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  await issuesService.deleteIssue(
    param(req, 'projectId'),
    paramInt(req, 'issueNumber'),
    req.userId!,
  );
  res.status(204).send();
});

export const addComment = asyncHandler(async (req: Request, res: Response) => {
  const parsed = validate(createCommentSchema, req.body);
  const commentBody = String(parsed.body);
  const issue = await issuesService.getIssue(param(req, 'projectId'), paramInt(req, 'issueNumber'));
  const comment = await issuesService.addComment(issue.id, req.userId!, commentBody);
  res.status(201).json(comment);
});

export const updateComment = asyncHandler(async (req: Request, res: Response) => {
  const { body } = req.body;
  if (!body || typeof body !== 'string') {
    throw new AppError(400, 'body is required');
  }
  const comment = await issuesService.updateComment(param(req, 'commentId'), req.userId!, body);
  res.json(comment);
});

export const deleteComment = asyncHandler(async (req: Request, res: Response) => {
  await issuesService.deleteComment(param(req, 'commentId'), req.userId!);
  res.status(204).send();
});

export const board = asyncHandler(async (req: Request, res: Response) => {
  const columns = await issuesService.getBoard(param(req, 'projectId'));
  res.json(columns);
});

export const listPullRequests = asyncHandler(async (req: Request, res: Response) => {
  const prs = await issuesService.getIssuePullRequests(
    param(req, 'projectId'),
    paramInt(req, 'issueNumber'),
  );
  res.json(prs);
});

export const moveIssue = asyncHandler(async (req: Request, res: Response) => {
  const { columnId, position } = req.body;
  const issue = await issuesService.moveIssue(
    param(req, 'projectId'),
    paramInt(req, 'issueNumber'),
    columnId,
    position,
  );
  res.json(issue);
});

export const setParent = asyncHandler(async (req: Request, res: Response) => {
  const { parentIssueNumber } = req.body;
  const issue = await issuesService.setParent(
    param(req, 'projectId'),
    paramInt(req, 'issueNumber'),
    parentIssueNumber !== undefined && parentIssueNumber !== null
      ? parseInt(parentIssueNumber, 10)
      : null,
  );
  res.json(issue);
});

export const getChildren = asyncHandler(async (req: Request, res: Response) => {
  const children = await issuesService.getChildren(
    param(req, 'projectId'),
    paramInt(req, 'issueNumber'),
  );
  res.json(children);
});

export const getProgress = asyncHandler(async (req: Request, res: Response) => {
  const progress = await issuesService.getEpicProgress(
    param(req, 'projectId'),
    paramInt(req, 'issueNumber'),
  );
  res.json(progress);
});

export const roadmap = asyncHandler(async (req: Request, res: Response) => {
  const data = await issuesService.getRoadmap(param(req, 'projectId'));
  res.json(data);
});

export const logWork = asyncHandler(async (req: Request, res: Response) => {
  const data = validate(logWorkSchema, req.body);
  const result = await issuesService.logWork(
    param(req, 'projectId'),
    paramInt(req, 'issueNumber'),
    req.userId!,
    data.minutes,
    data.description,
  );
  res.status(201).json(result);
});

export const getWorklogs = asyncHandler(async (req: Request, res: Response) => {
  const worklogs = await issuesService.getWorklogs(
    param(req, 'projectId'),
    paramInt(req, 'issueNumber'),
  );
  res.json(worklogs);
});

export const bulkUpdate = asyncHandler(async (req: Request, res: Response) => {
  const data = validate(bulkUpdateIssuesSchema, req.body);
  const result = await issuesService.bulkUpdate(
    param(req, 'projectId'),
    data.issueIds,
    data.updates,
    req.userId!,
  );
  res.json(result);
});

export const getTimeReport = asyncHandler(async (req: Request, res: Response) => {
  const report = await issuesService.getTimeReport(param(req, 'projectId'));
  res.json(report);
});

export const exportCsv = asyncHandler(async (req: Request, res: Response) => {
  const csv = await issuesService.exportIssuesCsv(param(req, 'projectId'));
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="issues.csv"');
  res.send(csv);
});
