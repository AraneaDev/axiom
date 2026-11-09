import { z } from 'zod';

import { defineAction } from '../../actions/define';
import { registerActions } from '../../actions/registry';
import { assertOwnerOrOrgAdmin } from '../service-accounts/service-accounts.service';

import { sendTestEvent } from './sender';
import * as service from './webhook-config.service';

const botTarget = z.object({ id: z.string() });
const webhook = z.looseObject({ url: z.string() });
const secretOut = z.looseObject({ secret: z.string() });

// Changing where a bot's events go, or the secret that signs them, is for a person in the web UI:
// a token could otherwise send a bot's events to a place of its choosing
registerActions([
  defineAction({
    name: 'serviceAccount.setWebhook',
    uiOnly: true,
    area: 'orgs',
    kind: 'write',
    summary: "Set the URL of a bot's webhook; a new one gets a secret, shown once",
    target: botTarget,
    input: botTarget.extend({ url: z.string().min(1).max(2000) }),
    output: z.looseObject({ webhook, secret: z.string().optional() }),
    rest: { method: 'PUT', path: '/api/service-accounts/:id/webhook' },
    authorize: async (ctx, { id }) => assertOwnerOrOrgAdmin(ctx.userId, id),
    handler: async (_ctx, { id, url }) => service.setBotWebhook(id, url),
  }),
  defineAction({
    name: 'serviceAccount.rotateWebhookSecret',
    uiOnly: true,
    area: 'orgs',
    kind: 'write',
    summary: "Give a bot's webhook a new secret; the old one stops working. Shown once",
    target: botTarget,
    input: botTarget,
    output: secretOut,
    rest: { method: 'POST', path: '/api/service-accounts/:id/webhook/rotate-secret', status: 200 },
    authorize: async (ctx, { id }) => assertOwnerOrOrgAdmin(ctx.userId, id),
    handler: async (_ctx, { id }) => service.rotateBotWebhookSecret(id),
  }),
  defineAction({
    name: 'serviceAccount.deleteWebhook',
    uiOnly: true,
    area: 'orgs',
    kind: 'write',
    summary: "Remove a bot's webhook and the events still waiting to be sent",
    target: botTarget,
    input: botTarget,
    output: z.void(),
    rest: { method: 'DELETE', path: '/api/service-accounts/:id/webhook' },
    authorize: async (ctx, { id }) => assertOwnerOrOrgAdmin(ctx.userId, id),
    handler: async (_ctx, { id }) => {
      await service.deleteBotWebhook(id);
    },
  }),
  defineAction({
    name: 'serviceAccount.resumeWebhook',
    uiOnly: true,
    area: 'orgs',
    kind: 'write',
    summary: 'Start a paused webhook of a bot again and clear its failure count',
    target: botTarget,
    input: botTarget,
    output: webhook,
    rest: { method: 'POST', path: '/api/service-accounts/:id/webhook/resume', status: 200 },
    authorize: async (ctx, { id }) => assertOwnerOrOrgAdmin(ctx.userId, id),
    handler: async (_ctx, { id }) => service.resumeBotWebhook(id),
  }),
  defineAction({
    name: 'serviceAccount.testWebhook',
    uiOnly: true,
    area: 'orgs',
    kind: 'write',
    summary:
      "Send a ping to a bot's webhook now, even while paused, and log it; the failure count and " +
      'the pause stay as they are',
    target: botTarget,
    input: botTarget,
    output: z.looseObject({ id: z.string(), type: z.string(), status: z.string() }),
    rest: { method: 'POST', path: '/api/service-accounts/:id/webhook/test', status: 200 },
    authorize: async (ctx, { id }) => assertOwnerOrOrgAdmin(ctx.userId, id),
    handler: async (_ctx, { id }) => sendTestEvent(id),
  }),
  defineAction({
    name: 'serviceAccount.webhook',
    area: 'orgs',
    kind: 'read',
    summary:
      "Read a bot's webhook (never its secret) and its latest 50 deliveries; an issue key shows " +
      'only for a project you can read',
    target: botTarget,
    input: botTarget,
    output: z.looseObject({ webhook: webhook.nullable(), deliveries: z.array(z.looseObject({})) }),
    rest: { method: 'GET', path: '/api/service-accounts/:id/webhook' },
    authorize: async (ctx, { id }) => assertOwnerOrOrgAdmin(ctx.userId, id),
    handler: async (ctx, { id }) => service.getBotWebhook(id, ctx.userId),
  }),
]);
