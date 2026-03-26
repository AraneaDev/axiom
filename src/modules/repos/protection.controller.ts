import { Request, Response } from 'express';

import { asyncHandler } from '../../utils/asyncHandler';
import { param } from '../../utils/params';

import * as protectionService from './protection.service';

export const create = asyncHandler(async (req: Request, res: Response) => {
  const rule = await protectionService.createRule(param(req, 'repoId'), req.body);
  res.status(201).json(rule);
});

export const list = asyncHandler(async (req: Request, res: Response) => {
  res.json(await protectionService.listRules(param(req, 'repoId')));
});

export const get = asyncHandler(async (req: Request, res: Response) => {
  res.json(await protectionService.getRule(param(req, 'ruleId')));
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  res.json(await protectionService.updateRule(param(req, 'ruleId'), req.body));
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  await protectionService.deleteRule(param(req, 'ruleId'));
  res.status(204).send();
});
