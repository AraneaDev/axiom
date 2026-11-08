import { z } from 'zod';

import { orgMember } from '../../actions/authorize';
import { defineAction } from '../../actions/define';
import * as previews from '../../actions/previews';
import { registerActions } from '../../actions/registry';
import { createApiTokenSchema, registerSchema } from '../../utils/validation';

import * as service from './service-accounts.service';

// Responses keep the shape the REST routes would have had
const record = z.looseObject({ id: z.string() });

const nothing = z.void();
const newToken = z.looseObject({ id: z.string(), token: z.string() });

const orgTarget = z.object({ orgId: z.string() });
const botTarget = z.object({ id: z.string() });
const botToken = botTarget.extend({ tokenId: z.string() });

const ownerIds = z.array(z.string()).min(1).max(50);
const description = z.string().max(500);

// Creating and deleting a bot and choosing its owners are for a person in the web UI, never a
// token: a token could otherwise make itself a bot, or move a bot to owners of its choosing
registerActions([
  defineAction({
    name: 'serviceAccount.create',
    uiOnly: true,
    area: 'orgs',
    kind: 'write',
    summary: 'Create a service account (a bot) in an organization, with its owners',
    target: orgTarget,
    input: orgTarget.extend({
      username: registerSchema.shape.username,
      displayName: registerSchema.shape.displayName,
      description: description.optional(),
      ownerIds,
    }),
    output: record,
    rest: { method: 'POST', path: '/api/orgs/:orgId/service-accounts' },
    authorize: async (ctx, { orgId }) => service.assertOrgAdmin(ctx.userId, orgId),
    handler: async (ctx, { orgId, ...data }) =>
      service.createServiceAccount(orgId, ctx.userId, data),
  }),
  defineAction({
    name: 'serviceAccount.list',
    area: 'orgs',
    kind: 'read',
    summary:
      "List an organization's service accounts: all for an org admin, the ones you own otherwise",
    target: orgTarget,
    input: orgTarget,
    output: z.array(record),
    rest: { method: 'GET', path: '/api/orgs/:orgId/service-accounts' },
    // Members only here; the handler narrows to the caller's own bots and refuses whoever owns none
    authorize: orgMember<z.infer<typeof orgTarget>>((input) => input.orgId),
    handler: async (ctx, { orgId }) => service.listServiceAccounts(orgId, ctx.userId),
  }),
  defineAction({
    name: 'serviceAccount.get',
    area: 'orgs',
    kind: 'read',
    summary: 'Read one service account: status, owners, memberships and tokens',
    target: botTarget,
    input: botTarget,
    output: record,
    rest: { method: 'GET', path: '/api/service-accounts/:id' },
    authorize: async (ctx, { id }) => service.assertCanAccess(ctx.userId, id, 'read'),
    handler: async (_ctx, { id }) => service.describeServiceAccount(id),
  }),
  defineAction({
    name: 'serviceAccount.update',
    uiOnly: true,
    area: 'orgs',
    kind: 'write',
    summary: "Change a service account's display name or description",
    target: botTarget,
    input: botTarget.extend({
      displayName: registerSchema.shape.displayName.optional(),
      description: description.optional(),
    }),
    output: record,
    rest: { method: 'PATCH', path: '/api/service-accounts/:id' },
    authorize: async (ctx, { id }) => service.assertCanAccess(ctx.userId, id, 'manage'),
    handler: async (_ctx, { id, ...data }) => service.updateServiceAccount(id, data),
  }),
  defineAction({
    name: 'serviceAccount.setOwners',
    uiOnly: true,
    area: 'orgs',
    kind: 'write',
    summary: "Replace a service account's owners: at least one, each a person in its org",
    target: botTarget,
    input: botTarget.extend({ ownerIds }),
    output: record,
    rest: { method: 'PUT', path: '/api/service-accounts/:id/owners' },
    authorize: async (ctx, { id }) => service.assertCanAccess(ctx.userId, id, 'manage'),
    handler: async (_ctx, { id, ownerIds: owners }) => service.setOwners(id, owners),
  }),
  defineAction({
    name: 'serviceAccount.delete',
    uiOnly: true,
    destructive: true,
    area: 'orgs',
    kind: 'write',
    summary: 'Delete a service account, its tokens and its pending requests; its activity stays',
    target: botTarget,
    input: botTarget,
    output: nothing,
    rest: { method: 'DELETE', path: '/api/service-accounts/:id' },
    authorize: async (ctx, { id }) => service.assertCanAccess(ctx.userId, id, 'manage'),
    handler: async (_ctx, { id }) => {
      await service.deleteServiceAccount(id);
    },
  }),
  // An owner or an org admin stops a bot at once, and starts it again. For a token both wait for
  // a person's approval, the bot's own token included
  defineAction({
    name: 'serviceAccount.suspend',
    admin: true,
    area: 'orgs',
    kind: 'write',
    summary:
      'Suspend a service account: its tokens stop working and its waiting requests are cancelled',
    target: botTarget,
    input: botTarget,
    output: record,
    preview: (_ctx, { id }) => previews.serviceAccountSuspend(id),
    orgIds: async (_ctx, { id }) => service.orgsOfServiceAccount(id),
    rest: { method: 'POST', path: '/api/service-accounts/:id/suspend', status: 200 },
    authorize: async (ctx, { id }) => service.assertOwnerOrOrgAdmin(ctx.userId, id),
    handler: async (_ctx, { id }) => service.suspendServiceAccount(id),
  }),
  defineAction({
    name: 'serviceAccount.resume',
    admin: true,
    area: 'orgs',
    kind: 'write',
    summary:
      'Resume a service account suspended by hand. One without an owner resumes when it gets one',
    target: botTarget,
    input: botTarget,
    output: record,
    preview: (_ctx, { id }) => previews.serviceAccountResume(id),
    orgIds: async (_ctx, { id }) => service.orgsOfServiceAccount(id),
    rest: { method: 'POST', path: '/api/service-accounts/:id/resume', status: 200 },
    authorize: async (ctx, { id }) => service.assertOwnerOrOrgAdmin(ctx.userId, id),
    handler: async (_ctx, { id }) => service.resumeServiceAccount(id),
  }),
  // A bot's tokens are made, rotated and revoked by an org admin or an owner in the web UI: a
  // token, the bot's own included, could otherwise mint itself more reach or a longer life
  defineAction({
    name: 'serviceAccount.createToken',
    uiOnly: true,
    area: 'orgs',
    kind: 'write',
    summary:
      'Create a token for a service account: no admin scope, expiring in 1 to 365 days (90 by ' +
      'default). The raw token is shown once',
    target: botTarget,
    input: botTarget.extend({
      name: createApiTokenSchema.shape.name,
      scopes: createApiTokenSchema.shape.scopes,
      expiresInDays: z
        .number()
        .int()
        .min(1)
        .max(service.BOT_TOKEN_MAX_DAYS)
        .default(service.BOT_TOKEN_DEFAULT_DAYS),
    }),
    output: newToken,
    rest: { method: 'POST', path: '/api/service-accounts/:id/tokens' },
    authorize: async (ctx, { id }) => service.assertCanManageTokens(ctx.userId, id),
    handler: async (_ctx, { id, ...data }) => service.createBotToken(id, data),
  }),
  defineAction({
    name: 'serviceAccount.rotateToken',
    uiOnly: true,
    area: 'orgs',
    kind: 'write',
    summary:
      "Rotate a service account's token: a new one with the same name and scopes, and the old " +
      'one stops within 7 days. The raw token is shown once',
    input: botToken,
    output: newToken,
    rest: { method: 'POST', path: '/api/service-accounts/:id/tokens/:tokenId/rotate' },
    authorize: async (ctx, { id }) => service.assertCanManageTokens(ctx.userId, id),
    handler: async (_ctx, { id, tokenId }) => service.rotateBotToken(id, tokenId),
  }),
  defineAction({
    name: 'serviceAccount.revokeToken',
    uiOnly: true,
    destructive: true,
    area: 'orgs',
    kind: 'write',
    summary: "Revoke a service account's token, at once",
    input: botToken,
    output: nothing,
    rest: { method: 'DELETE', path: '/api/service-accounts/:id/tokens/:tokenId' },
    authorize: async (ctx, { id }) => service.assertCanManageTokens(ctx.userId, id),
    handler: async (_ctx, { id, tokenId }) => {
      await service.revokeBotToken(id, tokenId);
    },
  }),
]);
