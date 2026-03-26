import { Request, Response } from 'express';

import { asyncHandler } from '../../utils/asyncHandler';
import { param } from '../../utils/params';

import * as webhooksService from './webhooks.service';

export const create = asyncHandler(async (req: Request, res: Response) => {
  const webhook = await webhooksService.createWebhook(param(req, 'repoId'), req.body);
  res.status(201).json(webhook);
});

export const list = asyncHandler(async (req: Request, res: Response) => {
  res.json(await webhooksService.listWebhooks(param(req, 'repoId')));
});

export const get = asyncHandler(async (req: Request, res: Response) => {
  res.json(await webhooksService.getWebhook(param(req, 'webhookId')));
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  res.json(await webhooksService.updateWebhook(param(req, 'webhookId'), req.body));
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  await webhooksService.deleteWebhook(param(req, 'webhookId'));
  res.status(204).send();
});

export const listDeliveries = asyncHandler(async (req: Request, res: Response) => {
  res.json(await webhooksService.listDeliveries(param(req, 'webhookId')));
});

export const redeliver = asyncHandler(async (req: Request, res: Response) => {
  res.json(
    await webhooksService.redeliverWebhook(param(req, 'webhookId'), param(req, 'deliveryId')),
  );
});
