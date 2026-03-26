import { Request, Response } from 'express';

import { asyncHandler } from '../../utils/asyncHandler';
import { param } from '../../utils/params';
import {
  validate,
  createWorkflowRuleSchema,
  updateWorkflowRuleSchema,
} from '../../utils/validation';

import * as workflowService from './workflow.service';

export const create = asyncHandler(async (req: Request, res: Response) => {
  const data = validate(createWorkflowRuleSchema, req.body);
  const rule = await workflowService.createRule(param(req, 'projectId'), data);
  res.status(201).json(rule);
});

export const list = asyncHandler(async (req: Request, res: Response) => {
  const rules = await workflowService.listRules(param(req, 'projectId'));
  res.json(rules);
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const data = validate(updateWorkflowRuleSchema, req.body);
  const rule = await workflowService.updateRule(
    param(req, 'ruleId'),
    param(req, 'projectId'),
    data,
  );
  res.json(rule);
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  await workflowService.deleteRule(param(req, 'ruleId'));
  res.status(204).send();
});
