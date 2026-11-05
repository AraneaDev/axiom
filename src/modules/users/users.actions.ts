import { z } from 'zod';

import { isToken } from '../../actions/approval-policy';
import { defineAction, type ActionContext } from '../../actions/define';
import * as previews from '../../actions/previews';
import { registerActions } from '../../actions/registry';
import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { scopeAllows, type ScopeArea } from '../../middleware/token-scopes';
import { createApiTokenSchema } from '../../utils/validation';

import * as usersService from './users.service';

const DAY_MS = 24 * 60 * 60 * 1000;

const newTokenTarget = z.object({
  scopes: createApiTokenSchema.shape.scopes,
  expiresInDays: createApiTokenSchema.shape.expiresInDays,
});

/**
 * A token can't outlive the one that asks for it, as an expiry is a bound a person put on an agent
 * (A27). It must have an expiry, no later than the asker's. A token with no expiry is free.
 * @param ctx - Who asks
 * @param expiresInDays - After how many days the new token expires, if ever
 * @throws {AppError} 400 TOKEN_OUTLIVES_ASKER
 */
async function withinOwnExpiry(ctx: ActionContext, expiresInDays?: number): Promise<void> {
  const asker = await prisma.apiToken.findUnique({
    where: { id: ctx.apiTokenId ?? '' },
    select: { expiresAt: true },
  });
  if (!asker?.expiresAt) return;
  const until = expiresInDays ? Date.now() + expiresInDays * DAY_MS : Infinity;
  if (until > asker.expiresAt.getTime()) {
    throw new AppError(
      400,
      `A token can't outlive the token that asks for it: set expiresInDays so it expires by ${asker.expiresAt.toISOString()}`,
      'TOKEN_OUTLIVES_ASKER',
    );
  }
}

/**
 * A token can't ask for more than it holds, in reach or in time, so an approval never widens what
 * an agent can do. Runs again at approval, against what the token holds by then.
 * @param ctx - Who asks
 * @param input - What the new token would hold
 * @param input.scopes - Its scopes
 * @param input.expiresInDays - After how many days it expires, if ever
 */
async function withinOwnReach(
  ctx: ActionContext,
  { scopes, expiresInDays }: z.infer<typeof newTokenTarget>,
): Promise<void> {
  if (!isToken(ctx)) return;
  const beyond = scopes.filter((scope) => {
    const [area, kind] = scope.split(':') as [ScopeArea, 'read' | 'write'];
    return !scopeAllows(ctx.scopes ?? [], area, kind);
  });
  if (beyond.length > 0) {
    throw new AppError(
      403,
      `A token can't ask for scopes it doesn't hold: ${beyond.join(', ')}`,
      'SCOPE',
    );
  }
  await withinOwnExpiry(ctx, expiresInDays);
}

// Your own tokens only, so no org's rules bind these. Listing them stays legacy until plan 4
registerActions([
  defineAction({
    name: 'token.create',
    admin: true,
    noOrg: true,
    area: 'admin',
    kind: 'write',
    summary:
      'Create an API token of your own, with no scope beyond those of the token that asks and no ' +
      'expiry past its own. The ' +
      'person who approves gets the token, once, and hands it over',
    target: newTokenTarget,
    input: newTokenTarget.extend({
      name: createApiTokenSchema.shape.name,
    }),
    output: z.looseObject({ id: z.string(), token: z.string() }),
    preview: (_ctx, { name, scopes, expiresInDays }) =>
      previews.tokenCreate(name, scopes, expiresInDays),
    // The secret stays in the approver's answer: not in the table, not with the agent (A4)
    redactResult: ({ token: _token, ...rest }) => rest,
    rest: { method: 'POST', path: '/api/users/me/tokens' },
    authorize: withinOwnReach,
    handler: async (ctx, input) => usersService.createApiToken(ctx.userId, input),
  }),
  defineAction({
    name: 'token.revoke',
    admin: true,
    destructive: true,
    noOrg: true,
    area: 'admin',
    kind: 'write',
    summary: 'Revoke an API token of your own',
    input: z.object({ tokenId: z.string() }),
    output: z.void(),
    preview: (ctx, { tokenId }) => previews.tokenRevoke(ctx.userId, tokenId, ctx.apiTokenId),
    rest: { method: 'DELETE', path: '/api/users/me/tokens/:tokenId' },
    // Only your own: anyone else's answers 404 in the preview and the service
    authorize: async () => {},
    handler: async (ctx, { tokenId }) => {
      await usersService.deleteApiToken(ctx.userId, tokenId);
    },
  }),
]);
