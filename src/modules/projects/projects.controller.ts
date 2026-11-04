import { Request, Response } from 'express';

import { asyncHandler } from '../../utils/asyncHandler';
import { param } from '../../utils/params';
import { validate, createProjectSchema, updateProjectSchema } from '../../utils/validation';

import * as projectsService from './projects.service';

export const create = asyncHandler(async (req: Request, res: Response) => {
  const data = validate(createProjectSchema, req.body);
  const project = await projectsService.createProject(param(req, 'teamId'), data);
  res.status(201).json(project);
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const data = validate(updateProjectSchema, req.body);
  const project = await projectsService.updateProject(param(req, 'projectId'), data);
  res.json(project);
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  await projectsService.deleteProject(param(req, 'projectId'));
  res.status(204).send();
});

export const analytics = asyncHandler(async (req: Request, res: Response) => {
  const data = await projectsService.getProjectAnalytics(param(req, 'projectId'));
  res.json(data);
});
