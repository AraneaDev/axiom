import { NextFunction, Request, Response } from 'express';

import { param } from '../../utils/params';
import { validate, createMilestoneSchema, updateMilestoneSchema } from '../../utils/validation';

import * as milestonesService from './milestones.service';

/**
 * Create a new milestone.
 */
export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const body = validate(createMilestoneSchema, req.body);
    const milestone = await milestonesService.createMilestone(param(req, 'projectId'), body);
    res.status(201).json(milestone);
  } catch (err) {
    next(err);
  }
}

/**
 * List milestones for a project.
 */
export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const milestones = await milestonesService.listMilestones(param(req, 'projectId'));
    res.json(milestones);
  } catch (err) {
    next(err);
  }
}

/**
 * Get a single milestone.
 */
export async function get(req: Request, res: Response, next: NextFunction) {
  try {
    const milestone = await milestonesService.getMilestone(param(req, 'milestoneId'));
    res.json(milestone);
  } catch (err) {
    next(err);
  }
}

/**
 * Update a milestone.
 */
export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const body = validate(updateMilestoneSchema, req.body);
    const milestone = await milestonesService.updateMilestone(param(req, 'milestoneId'), body);
    res.json(milestone);
  } catch (err) {
    next(err);
  }
}

/**
 * Delete a milestone.
 */
export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    await milestonesService.deleteMilestone(param(req, 'milestoneId'));
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}
