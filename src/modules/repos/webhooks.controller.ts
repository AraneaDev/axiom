import { Request, Response, NextFunction } from 'express';

import { param } from '../../utils/params';

import * as webhooksService from './webhooks.service';

/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const webhook = await webhooksService.createWebhook(param(req, 'repoId'), req.body);
    res.status(201).json(webhook);
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
    res.json(await webhooksService.listWebhooks(param(req, 'repoId')));
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
    res.json(await webhooksService.getWebhook(param(req, 'webhookId')));
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
    res.json(await webhooksService.updateWebhook(param(req, 'webhookId'), req.body));
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
    await webhooksService.deleteWebhook(param(req, 'webhookId'));
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}
