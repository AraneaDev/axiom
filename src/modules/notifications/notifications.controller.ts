import type { Request, Response } from 'express';

import { param } from '../../utils/params';

import * as notificationsService from './notifications.service';

/**
 * GET /api/notifications
 * @param req
 * @param res
 */
export async function list(req: Request, res: Response) {
  const userId = req.userId!;
  const unreadOnly = req.query.unreadOnly === 'true';
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
  const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : undefined;

  const result = await notificationsService.listNotifications(userId, {
    unreadOnly,
    limit,
    offset,
  });
  res.json(result);
}

/**
 * PATCH /api/notifications/:id/read
 * @param req
 * @param res
 */
export async function markRead(req: Request, res: Response) {
  const userId = req.userId!;
  await notificationsService.markRead(param(req, 'id'), userId);
  res.json({ success: true });
}

/**
 * POST /api/notifications/read-all
 * @param req
 * @param res
 */
export async function markAllRead(req: Request, res: Response) {
  const userId = req.userId!;
  await notificationsService.markAllRead(userId);
  res.json({ success: true });
}

/**
 * GET /api/notifications/unread-count
 * @param req
 * @param res
 */
export async function getCount(req: Request, res: Response) {
  const userId = req.userId!;
  const count = await notificationsService.getUnreadCount(userId);
  res.json({ count });
}
