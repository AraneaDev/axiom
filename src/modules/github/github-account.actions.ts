import { z } from 'zod';

import { defineAction } from '../../actions/define';
import { registerActions } from '../../actions/registry';

import * as service from './github-account.service';

const status = z.looseObject({ connected: z.boolean() });
const noInput = z.object({});

// A person's own GitHub account: their state, no org's. Reading it needs the github scope as
// every GitHub action does (no openToReadOf: that would swap the scope for issues or wiki
// reads). Connecting and disconnecting are a person's act in the web UI (uiOnly).
registerActions([
  defineAction({
    name: 'githubAccount.get',
    noOrg: true,
    area: 'github',
    kind: 'read',
    summary: 'Read whether you connected your GitHub account, and as whom',
    input: noInput,
    output: status,
    rest: { method: 'GET', path: '/api/github/account' },
    authorize: async () => {},
    handler: async (ctx) => service.getAccount(ctx.userId),
  }),
  defineAction({
    name: 'githubAccount.startConnect',
    uiOnly: true,
    noOrg: true,
    area: 'github',
    kind: 'write',
    summary: 'Start connecting your GitHub account: the GitHub page to send you to',
    input: noInput,
    output: z.looseObject({ authorizeUrl: z.string() }),
    rest: { method: 'POST', path: '/api/github/account/connect', status: 200, emptyBody: true },
    authorize: async () => {},
    handler: async (ctx) => service.startConnect(ctx.userId),
  }),
  defineAction({
    name: 'githubAccount.completeConnect',
    uiOnly: true,
    noOrg: true,
    area: 'github',
    kind: 'write',
    summary: 'Finish connecting your GitHub account with the code and state GitHub sent back',
    target: noInput,
    input: noInput.extend({
      code: z
        .string()
        .min(1)
        .max(200)
        .regex(/^[\w-]+$/, 'Not an authorization code'),
      state: z.string().min(1).max(200),
    }),
    output: status,
    rest: { method: 'POST', path: '/api/github/account/connect/complete', status: 200 },
    authorize: async () => {},
    handler: async (ctx, { code, state }) => service.completeConnect(ctx.userId, code, state),
  }),
  defineAction({
    name: 'githubAccount.disconnect',
    uiOnly: true,
    noOrg: true,
    area: 'github',
    kind: 'write',
    summary: 'Disconnect your GitHub account and have GitHub revoke the token',
    input: noInput,
    output: status,
    rest: { method: 'DELETE', path: '/api/github/account' },
    authorize: async () => {},
    handler: async (ctx) => service.disconnect(ctx.userId),
  }),
]);
