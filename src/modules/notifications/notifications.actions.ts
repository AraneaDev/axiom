import { z } from 'zod';

import { isToken } from '../../actions/approval-policy';
import { defineAction } from '../../actions/define';
import { registerActions } from '../../actions/registry';
import { AppError } from '../../middleware/errorHandler';
import { parsePagination } from '../../utils/pagination';
import { firstQueryText, queryCount, queryText } from '../../utils/validation';

import * as notificationsService from './notifications.service';

// Responses keep the shape the REST routes always had (R3)
const success = z.looseObject({ success: z.boolean() });
const noTarget = z.object({});
const idInput = z.object({ id: z.string() });

// A person's own notifications: any token that reads issues or wiki may read and clear them,
// but for the lines that tell a person an agent waits (A22), which a token never sees or clears
const OWN_STATE = ['issues', 'wiki'] as const;

// The static paths come before /:id/read
registerActions([
  defineAction({
    name: 'notification.list',
    area: 'issues',
    kind: 'read',
    openToReadOf: OWN_STATE,
    summary:
      'List your notifications, newest first, with the total. Approval requests of agents are ' +
      'not listed to a token: they carry what an agent wants to run, and are for you',
    target: noTarget,
    input: noTarget.extend({ unreadOnly: queryText, limit: queryCount, offset: queryCount }),
    output: z.looseObject({ notifications: z.array(z.looseObject({ id: z.string() })) }),
    rest: { method: 'GET', path: '/api/notifications' },
    authorize: async () => {},
    handler: async (ctx, { unreadOnly, limit, offset }) => {
      const { take, skip } = parsePagination({
        limit: firstQueryText(limit),
        offset: firstQueryText(offset),
      });
      return notificationsService.listNotifications(
        ctx.userId,
        { unreadOnly: firstQueryText(unreadOnly) === 'true', limit: take, offset: skip },
        isToken(ctx),
      );
    },
  }),
  defineAction({
    name: 'notification.unreadCount',
    area: 'issues',
    kind: 'read',
    openToReadOf: OWN_STATE,
    summary: 'Count your unread notifications',
    input: noTarget,
    output: z.looseObject({ count: z.number() }),
    rest: { method: 'GET', path: '/api/notifications/unread-count' },
    authorize: async () => {},
    handler: async (ctx) => ({ count: await notificationsService.getUnreadCount(ctx.userId) }),
  }),
  defineAction({
    name: 'notification.preferences',
    area: 'issues',
    kind: 'read',
    openToReadOf: OWN_STATE,
    summary: 'Read how you are told of each kind of event, in the app and by email',
    input: noTarget,
    output: z.looseObject({ preferences: z.array(z.looseObject({ eventType: z.string() })) }),
    rest: { method: 'GET', path: '/api/notifications/preferences' },
    authorize: async () => {},
    handler: async (ctx) => ({
      preferences: await notificationsService.getPreferences(ctx.userId),
    }),
  }),
  defineAction({
    name: 'notification.setPreference',
    area: 'issues',
    kind: 'write',
    openToReadOf: OWN_STATE,
    noOrg: true,
    summary: 'Choose whether one kind of event reaches you in the app and by email',
    target: noTarget,
    input: noTarget.extend({
      eventType: z.string().min(1).max(100),
      inApp: z.boolean().optional(),
      email: z.boolean().optional(),
    }),
    output: z.looseObject({ preference: z.looseObject({ eventType: z.string() }) }),
    rest: { method: 'PATCH', path: '/api/notifications/preferences', status: 200 },
    authorize: async () => {},
    handler: async (ctx, { eventType, inApp, email }) => {
      // How a person hears of an agent's request is theirs to decide, not the agent's (A22)
      if (isToken(ctx) && eventType === 'agent:approval') {
        throw new AppError(
          403,
          "A token can't change how you hear of agent approvals: do this in the web UI",
          'SCOPE',
        );
      }
      const preference = await notificationsService.updatePreference(ctx.userId, eventType, {
        inApp,
        email,
      });
      return { preference };
    },
  }),
  defineAction({
    name: 'notification.markAllRead',
    area: 'issues',
    kind: 'write',
    openToReadOf: OWN_STATE,
    noOrg: true,
    summary: 'Mark all your notifications read; a token leaves the approval requests of agents',
    input: noTarget,
    output: success,
    rest: { method: 'POST', path: '/api/notifications/read-all', status: 200 },
    authorize: async () => {},
    handler: async (ctx) => {
      await notificationsService.markAllRead(ctx.userId, isToken(ctx));
      return { success: true };
    },
  }),
  defineAction({
    name: 'notification.markRead',
    area: 'issues',
    kind: 'write',
    openToReadOf: OWN_STATE,
    noOrg: true,
    summary: 'Mark one of your notifications read',
    input: idInput,
    output: success,
    rest: { method: 'PATCH', path: '/api/notifications/:id/read' },
    // Only your own: the service matches the user as well
    authorize: async () => {},
    handler: async (ctx, { id }) => {
      await notificationsService.markRead(id, ctx.userId, isToken(ctx));
      return { success: true };
    },
  }),
]);
