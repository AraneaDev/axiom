import { Request, Response, NextFunction } from 'express';
import * as webhooksService from './webhooks.service';
import { param } from '../../utils/params';

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const webhook = await webhooksService.createWebhook(param(req, 'repoId'), req.body);
    res.status(201).json(webhook);
  } catch (err) { next(err); }
}

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await webhooksService.listWebhooks(param(req, 'repoId')));
  } catch (err) { next(err); }
}

export async function get(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await webhooksService.getWebhook(param(req, 'webhookId')));
  } catch (err) { next(err); }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await webhooksService.updateWebhook(param(req, 'webhookId'), req.body));
  } catch (err) { next(err); }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    await webhooksService.deleteWebhook(param(req, 'webhookId'));
    res.status(204).send();
  } catch (err) { next(err); }
}
