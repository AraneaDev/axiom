import type { Request, Response, NextFunction } from 'express';

import { parsePagination } from '../../utils/pagination';
import { param } from '../../utils/params';

import * as notificationsService from './notifications.service';

/**
 * GET /api/notifications
 * @param req
 * @param res
 * @param next
 */
export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.userId!;
    const unreadOnly = req.query.unreadOnly === 'true';
    const { take, skip } = parsePagination(req.query as Record<string, string>);

    const result = await notificationsService.listNotifications(userId, {
      unreadOnly,
      limit: take,
      offset: skip,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /api/notifications/:id/read
 * @param req
 * @param res
 * @param next
 */
export async function markRead(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.userId!;
    await notificationsService.markRead(param(req, 'id'), userId);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/notifications/read-all
 * @param req
 * @param res
 * @param next
 */
export async function markAllRead(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.userId!;
    await notificationsService.markAllRead(userId);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/notifications/unread-count
 * @param req
 * @param res
 * @param next
 */
export async function getCount(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.userId!;
    const count = await notificationsService.getUnreadCount(userId);
    res.json({ count });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/notifications/preferences
 * @param req
 * @param res
 * @param next
 */
export async function getPreferences(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.userId!;
    const preferences = await notificationsService.getPreferences(userId);
    res.json({ preferences });
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /api/notifications/preferences
 * @param req
 * @param res
 * @param next
 */
export async function updatePreference(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.userId!;
    const { eventType, inApp, email } = req.body;
    const preference = await notificationsService.updatePreference(userId, eventType, {
      inApp,
      email,
    });
    res.json({ preference });
  } catch (err) {
    next(err);
  }
}
