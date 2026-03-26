import { Request, Response } from 'express';

import { asyncHandler } from '../../utils/asyncHandler';
import { param } from '../../utils/params';
import { validate, createMilestoneSchema, updateMilestoneSchema } from '../../utils/validation';

import * as milestonesService from './milestones.service';

export const create = asyncHandler(async (req: Request, res: Response) => {
  const body = validate(createMilestoneSchema, req.body);
  const milestone = await milestonesService.createMilestone(param(req, 'projectId'), body);
  res.status(201).json(milestone);
});

export const list = asyncHandler(async (req: Request, res: Response) => {
  const milestones = await milestonesService.listMilestones(param(req, 'projectId'));
  res.json(milestones);
});

export const get = asyncHandler(async (req: Request, res: Response) => {
  const milestone = await milestonesService.getMilestone(param(req, 'milestoneId'));
  res.json(milestone);
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const body = validate(updateMilestoneSchema, req.body);
  const milestone = await milestonesService.updateMilestone(param(req, 'milestoneId'), body);
  res.json(milestone);
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  await milestonesService.deleteMilestone(param(req, 'milestoneId'));
  res.status(204).send();
});
