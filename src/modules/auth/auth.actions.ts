import { z } from 'zod';

import { defineAction, definePublicAction } from '../../actions/define';
import { registerActions } from '../../actions/registry';
import {
  forgotPasswordSchema,
  loginSchema,
  refreshSchema,
  registerSchema,
  resetPasswordSchema,
} from '../../utils/validation';

import * as authService from './auth.service';

/**
 * Sign-in, session and two-factor routes. All are for a person at the web UI, so none is open to a
 * token or MCP (ruling B6). Register, login, refresh and the password reset take no credential and
 * run with no user (ctx.userId is undefined and must never be read); the app mounts their
 * per-IP limiters ahead of the registry (index.ts). The rest need a session, as they did.
 */
const noTarget = z.object({});
const result = z.looseObject({});
const nothing = z.void();

const codeInput = noTarget.extend({ code: z.string() });

registerActions([
  definePublicAction({
    name: 'auth.register',
    uiOnly: true,
    area: 'issues',
    kind: 'write',
    summary: 'Create an account, with an invite code where the installation asks for one',
    target: noTarget,
    input: noTarget.extend(registerSchema.shape),
    output: result,
    rest: { method: 'POST', path: '/api/auth/register', public: true },
    authorize: async () => {},
    handler: async (_ctx, data) => authService.register(data),
  }),
  definePublicAction({
    name: 'auth.login',
    uiOnly: true,
    area: 'issues',
    kind: 'write',
    summary: 'Sign in with an email or username and a password, and a 2FA code where it is on',
    target: noTarget,
    input: noTarget.extend(loginSchema.shape),
    output: result,
    rest: { method: 'POST', path: '/api/auth/login', status: 200, public: true },
    authorize: async () => {},
    handler: async (_ctx, data) => authService.login(data),
  }),
  definePublicAction({
    name: 'auth.refresh',
    uiOnly: true,
    area: 'issues',
    kind: 'write',
    summary: 'Swap a refresh token for a new access token',
    target: noTarget,
    input: noTarget.extend(refreshSchema.shape),
    output: result,
    rest: { method: 'POST', path: '/api/auth/refresh', status: 200, public: true },
    authorize: async () => {},
    handler: async (_ctx, { refreshToken }) => authService.refresh(refreshToken),
  }),
  defineAction({
    name: 'auth.logout',
    uiOnly: true,
    area: 'issues',
    kind: 'write',
    summary: 'End your session, and drop the refresh token that comes with the request',
    target: noTarget,
    input: noTarget.extend({ refreshToken: z.string().optional() }),
    output: nothing,
    rest: { method: 'POST', path: '/api/auth/logout', status: 204, optionalBody: true },
    // Your own session
    authorize: async () => {},
    handler: async (ctx, { refreshToken }) => {
      await authService.logout(ctx.userId, refreshToken);
    },
  }),
  definePublicAction({
    name: 'auth.forgotPassword',
    uiOnly: true,
    area: 'issues',
    kind: 'write',
    summary: 'Ask for a password reset mail',
    target: noTarget,
    input: noTarget.extend(forgotPasswordSchema.shape),
    output: result,
    rest: { method: 'POST', path: '/api/auth/forgot-password', status: 200, public: true },
    authorize: async () => {},
    handler: async (_ctx, { email }) => authService.requestPasswordReset(email),
  }),
  definePublicAction({
    name: 'auth.resetPassword',
    uiOnly: true,
    area: 'issues',
    kind: 'write',
    summary: 'Set a new password with the token from the reset mail',
    target: noTarget,
    input: noTarget.extend(resetPasswordSchema.shape),
    output: result,
    rest: { method: 'POST', path: '/api/auth/reset-password', status: 200, public: true },
    authorize: async () => {},
    handler: async (_ctx, { token, password }) => authService.resetPassword(token, password),
  }),
  defineAction({
    name: 'auth.twoFactorEnable',
    uiOnly: true,
    area: 'issues',
    kind: 'write',
    summary: 'Start two-factor setup: a new secret for your authenticator app',
    target: noTarget,
    input: noTarget,
    output: result,
    rest: { method: 'POST', path: '/api/auth/2fa/enable', status: 200, emptyBody: true },
    authorize: async () => {},
    handler: async (ctx) => authService.enableTwoFactor(ctx.userId),
  }),
  defineAction({
    name: 'auth.twoFactorVerify',
    uiOnly: true,
    area: 'issues',
    kind: 'write',
    summary: 'Switch two-factor on with a code from your authenticator app',
    target: noTarget,
    input: codeInput,
    output: result,
    rest: { method: 'POST', path: '/api/auth/2fa/verify', status: 200 },
    authorize: async () => {},
    handler: async (ctx, { code }) => authService.verifyAndActivateTwoFactor(ctx.userId, code),
  }),
  defineAction({
    name: 'auth.twoFactorDisable',
    uiOnly: true,
    area: 'issues',
    kind: 'write',
    summary: 'Switch two-factor off with a code from your authenticator app',
    target: noTarget,
    input: codeInput,
    output: result,
    rest: { method: 'POST', path: '/api/auth/2fa/disable', status: 200 },
    authorize: async () => {},
    handler: async (ctx, { code }) => authService.disableTwoFactor(ctx.userId, code),
  }),
]);
