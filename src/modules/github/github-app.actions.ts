import { z } from 'zod';

import { platformAdmin } from '../../actions/authorize';
import { defineAction } from '../../actions/define';
import * as previews from '../../actions/previews';
import { registerActions } from '../../actions/registry';

import * as service from './github-app.service';

const status = z.looseObject({
  configured: z.boolean(),
  installations: z.array(
    z.looseObject({
      id: z.union([z.number(), z.string()]),
      accountLogin: z.string(),
      suspended: z.boolean(),
    }),
  ),
});
const noInput = z.object({});

// One App for the whole instance: no org's rules bind these, and setting it up is a person's
// act in the web UI (uiOnly), never a token's
registerActions([
  defineAction({
    name: 'githubApp.status',
    noOrg: true,
    area: 'github',
    kind: 'read',
    summary: 'Read whether the GitHub App is set up, where to install it and who installed it',
    input: noInput,
    output: status,
    rest: { method: 'GET', path: '/api/github/app' },
    authorize: async () => {},
    handler: async () => service.getStatus(),
  }),
  defineAction({
    name: 'githubApp.startManifest',
    admin: true,
    uiOnly: true,
    noOrg: true,
    area: 'github',
    kind: 'write',
    summary: 'Start creating the GitHub App: the manifest and the GitHub page to post it to',
    target: noInput,
    input: noInput.extend({
      organization: z
        .string()
        .regex(service.GITHUB_LOGIN_PATTERN, 'Not a GitHub organization name')
        .optional()
        .describe('A GitHub organization to own the App, else your own account'),
    }),
    output: z.looseObject({ postUrl: z.string(), manifest: z.looseObject({}), state: z.string() }),
    rest: { method: 'POST', path: '/api/github/app/manifest', status: 200 },
    authorize: platformAdmin,
    handler: async (ctx, { organization }) => service.startManifest(ctx.userId, organization),
  }),
  defineAction({
    name: 'githubApp.completeManifest',
    admin: true,
    uiOnly: true,
    noOrg: true,
    area: 'github',
    kind: 'write',
    summary: 'Finish creating the GitHub App with the code and state GitHub redirected back with',
    target: noInput,
    input: noInput.extend({
      code: z
        .string()
        .min(1)
        .max(200)
        .regex(/^[\w-]+$/, 'Not a manifest code'),
      state: z.string().min(1).max(200),
    }),
    output: status,
    rest: { method: 'POST', path: '/api/github/app/manifest/complete', status: 200 },
    authorize: platformAdmin,
    handler: async (ctx, { code, state }) => service.completeManifest(ctx.userId, code, state),
  }),
  defineAction({
    name: 'githubApp.syncInstallations',
    admin: true,
    uiOnly: true,
    noOrg: true,
    area: 'github',
    kind: 'write',
    summary: 'Read the installations of the GitHub App from GitHub',
    input: noInput,
    output: status,
    rest: {
      method: 'POST',
      path: '/api/github/app/installations/sync',
      status: 200,
      emptyBody: true,
    },
    authorize: platformAdmin,
    handler: async () => service.syncInstallations(),
  }),
  defineAction({
    name: 'githubApp.delete',
    admin: true,
    destructive: true,
    uiOnly: true,
    noOrg: true,
    area: 'github',
    kind: 'write',
    summary: 'Forget the GitHub App here. It is not deleted on GitHub',
    input: noInput,
    output: z.looseObject({ deleted: z.boolean(), note: z.string() }),
    preview: () => previews.githubAppDelete(),
    rest: { method: 'DELETE', path: '/api/github/app' },
    authorize: platformAdmin,
    handler: async () => service.deleteApp(),
  }),
]);
