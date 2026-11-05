import { z } from 'zod';

import { isToken } from '../../actions/approval-policy';
import { defineAction, type ActionContext } from '../../actions/define';
import * as previews from '../../actions/previews';
import { registerActions } from '../../actions/registry';
import { AppError } from '../../middleware/errorHandler';
import { scopeAllows, type ScopeArea } from '../../middleware/token-scopes';
import { createApiTokenSchema } from '../../utils/validation';

import * as usersService from './users.service';

const newTokenTarget = z.object({ scopes: createApiTokenSchema.shape.scopes });

/**
 * A token can't ask for more than it holds, so an approval never widens what an agent can do. Runs
 * again at approval, against the scopes the token holds by then.
 * @param ctx - Who asks
 * @param input - What the new token would hold
 * @param input.scopes - Its scopes
 */
async function withinOwnScopes(
  ctx: ActionContext,
  { scopes }: z.infer<typeof newTokenTarget>,
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
      'Create an API token of your own, with no scope beyond those of the token that asks. The ' +
      'person who approves gets the token, once, and hands it over',
    target: newTokenTarget,
    input: newTokenTarget.extend({
      name: createApiTokenSchema.shape.name,
      expiresInDays: createApiTokenSchema.shape.expiresInDays,
    }),
    output: z.looseObject({ id: z.string(), token: z.string() }),
    preview: (_ctx, { name, scopes, expiresInDays }) =>
      previews.tokenCreate(name, scopes, expiresInDays),
    // The secret stays in the approver's answer: not in the table, not with the agent (A4)
    redactResult: ({ token: _token, ...rest }) => rest,
    rest: { method: 'POST', path: '/api/users/me/tokens' },
    authorize: withinOwnScopes,
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
    preview: (ctx, { tokenId }) => previews.tokenRevoke(ctx.userId, tokenId),
    rest: { method: 'DELETE', path: '/api/users/me/tokens/:tokenId' },
    // Only your own: anyone else's answers 404 in the preview and the service
    authorize: async () => {},
    handler: async (ctx, { tokenId }) => {
      await usersService.deleteApiToken(ctx.userId, tokenId);
    },
  }),
]);
