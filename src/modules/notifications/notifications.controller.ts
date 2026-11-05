import type { Request, Response } from 'express';

import { AppError } from '../../middleware/errorHandler';
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
  await notificationsService.markRead(param(req, 'id'), userId, req.apiTokenId !== undefined);
  res.json({ success: true });
});

export const markAllRead = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.userId!;
  await notificationsService.markAllRead(userId, req.apiTokenId !== undefined);
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
  if (typeof eventType !== 'string' || eventType === '') {
    throw new AppError(400, 'eventType must be a string');
  }
  // How a person hears of an agent's request is theirs to decide, not the agent's (A22)
  if (req.apiTokenId !== undefined && eventType === 'agent:approval') {
    throw new AppError(
      403,
      "A token can't change how you hear of agent approvals: do this in the web UI",
      'SCOPE',
    );
  }
  const preference = await notificationsService.updatePreference(userId, eventType, {
    inApp,
    email,
  });
  res.json({ preference });
});
