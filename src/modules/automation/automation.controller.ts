import { Request, Response, NextFunction } from 'express';

import { param } from '../../utils/params';

import * as automationService from './automation.service';

/**
 * @param req
 * @param res
 * @param next
 */
export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const rule = await automationService.createRule(param(req, 'projectId'), req.body);
    res.status(201).json(rule);
  } catch (err) {
    next(err);
  }
}

/**
 * @param req
 * @param res
 * @param next
 */
export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const rules = await automationService.listRules(param(req, 'projectId'));
    res.json(rules);
  } catch (err) {
    next(err);
  }
}

/**
 * @param req
 * @param res
 * @param next
 */
export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const rule = await automationService.updateRule(param(req, 'ruleId'), req.body);
    res.json(rule);
  } catch (err) {
    next(err);
  }
}

/**
 * @param req
 * @param res
 * @param next
 */
export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    await automationService.deleteRule(param(req, 'ruleId'));
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

/**
 * @param req
 * @param res
 * @param next
 */
export async function toggle(req: Request, res: Response, next: NextFunction) {
  try {
    const rule = await automationService.toggleRule(param(req, 'ruleId'));
    res.json(rule);
  } catch (err) {
    next(err);
  }
}
