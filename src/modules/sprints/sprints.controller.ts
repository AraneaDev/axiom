import { Request, Response } from 'express';

import { asyncHandler } from '../../utils/asyncHandler';
import { param } from '../../utils/params';
import {
  validate,
  createSprintSchema,
  updateSprintSchema,
  completeSprintSchema,
  addSprintIssuesSchema,
} from '../../utils/validation';

import * as sprintReportService from './sprint-report.service';
import * as sprintsService from './sprints.service';

export const create = asyncHandler(async (req: Request, res: Response) => {
  const body = validate(createSprintSchema, req.body);
  const sprint = await sprintsService.createSprint(param(req, 'projectId'), body);
  res.status(201).json(sprint);
});

export const list = asyncHandler(async (req: Request, res: Response) => {
  const sprints = await sprintsService.listSprints(param(req, 'projectId'), {
    status: req.query.status as string | undefined,
  });
  res.json(sprints);
});

export const get = asyncHandler(async (req: Request, res: Response) => {
  const sprint = await sprintsService.getSprint(param(req, 'sprintId'));
  res.json(sprint);
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const body = validate(updateSprintSchema, req.body);
  const sprint = await sprintsService.updateSprint(param(req, 'sprintId'), body);
  res.json(sprint);
});

export const start = asyncHandler(async (req: Request, res: Response) => {
  const sprint = await sprintsService.startSprint(param(req, 'sprintId'));
  res.json(sprint);
});

export const complete = asyncHandler(async (req: Request, res: Response) => {
  const body = validate(completeSprintSchema, req.body);
  const sprint = await sprintsService.completeSprint(param(req, 'sprintId'), body.moveToSprintId);
  res.json(sprint);
});

export const addIssues = asyncHandler(async (req: Request, res: Response) => {
  const body = validate(addSprintIssuesSchema, req.body);
  const sprint = await sprintsService.addIssuesToSprint(param(req, 'sprintId'), body.issueIds);
  res.json(sprint);
});

export const removeIssue = asyncHandler(async (req: Request, res: Response) => {
  await sprintsService.removeIssueFromSprint(param(req, 'issueId'));
  res.status(204).send();
});

export const velocity = asyncHandler(async (req: Request, res: Response) => {
  const count = req.query.count ? parseInt(req.query.count as string, 10) : undefined;
  const data = await sprintsService.getVelocity(param(req, 'projectId'), count);
  res.json(data);
});

export const backlog = asyncHandler(async (req: Request, res: Response) => {
  const issues = await sprintsService.getBacklog(param(req, 'projectId'));
  res.json(issues);
});

export const report = asyncHandler(async (req: Request, res: Response) => {
  const data = await sprintReportService.getSprintReport(
    param(req, 'projectId'),
    param(req, 'sprintId'),
  );
  res.json(data);
});
