import { Request, Response } from 'express';

import { asyncHandler } from '../../utils/asyncHandler';
import { param } from '../../utils/params';

import * as automationService from './automation.service';

export const create = asyncHandler(async (req: Request, res: Response) => {
  const rule = await automationService.createRule(param(req, 'projectId'), req.body);
  res.status(201).json(rule);
});

export const list = asyncHandler(async (req: Request, res: Response) => {
  const rules = await automationService.listRules(param(req, 'projectId'));
  res.json(rules);
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const rule = await automationService.updateRule(param(req, 'ruleId'), req.body);
  res.json(rule);
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  await automationService.deleteRule(param(req, 'ruleId'));
  res.status(204).send();
});

export const toggle = asyncHandler(async (req: Request, res: Response) => {
  const rule = await automationService.toggleRule(param(req, 'ruleId'));
  res.json(rule);
});
