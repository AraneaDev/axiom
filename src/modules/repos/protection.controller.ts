import { Request, Response, NextFunction } from 'express';

import { param } from '../../utils/params';

import * as protectionService from './protection.service';

/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const rule = await protectionService.createRule(param(req, 'repoId'), req.body);
    res.status(201).json(rule);
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
    res.json(await protectionService.listRules(param(req, 'repoId')));
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
    res.json(await protectionService.getRule(param(req, 'ruleId')));
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
    res.json(await protectionService.updateRule(param(req, 'ruleId'), req.body));
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
    await protectionService.deleteRule(param(req, 'ruleId'));
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}
