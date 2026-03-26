import type { Request, Response } from 'express';

import { asyncHandler } from '../../utils/asyncHandler';
import { parsePagination } from '../../utils/pagination';
import { param } from '../../utils/params';

import * as notificationsService from './notifications.service';

export const list = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.userId!;
  const unreadOnly = req.query.unreadOnly === 'true';
  const { take, skip } = parsePagination(req.query as Record<string, string>);

  const result = await notificationsService.listNotifications(userId, {
    unreadOnly,
    limit: take,
    offset: skip,
  });
  res.json(result);
});

export const markRead = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.userId!;
  await notificationsService.markRead(param(req, 'id'), userId);
  res.json({ success: true });
});

export const markAllRead = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.userId!;
  await notificationsService.markAllRead(userId);
  res.json({ success: true });
});

export const getCount = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.userId!;
  const count = await notificationsService.getUnreadCount(userId);
  res.json({ count });
});

export const getPreferences = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.userId!;
  const preferences = await notificationsService.getPreferences(userId);
  res.json({ preferences });
});

export const updatePreference = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.userId!;
  const { eventType, inApp, email } = req.body;
  const preference = await notificationsService.updatePreference(userId, eventType, {
    inApp,
    email,
  });
  res.json({ preference });
});
