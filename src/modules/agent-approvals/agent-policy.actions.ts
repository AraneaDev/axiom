import { z } from 'zod';

import { orgMember } from '../../actions/authorize';
import { defineAction, type ActionContext } from '../../actions/define';
import { registerActions } from '../../actions/registry';
import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';

import { describePolicyChange, getPolicy, rulesSchema, savePolicy } from './agent-policy.service';

const BASE = '/api/agent-policy';

const scope = z.enum(['org', 'user']);
const target = z.object({ scope, orgId: z.string().min(1).max(64).optional() });

const fullPolicy = z.object({
  requireFor: z.object({
    destructive: z.boolean(),
    admin: z.boolean(),
    bulkOver: z.number(),
    crossContainerMove: z.boolean(),
  }),
  expiresMinutes: z.number(),
  alsoRequire: z.array(z.string()),
  neverRequire: z.array(z.string()),
});

const policyView = z.looseObject({
  scope,
  orgId: z.string().nullable(),
  rules: rulesSchema,
  effective: fullPolicy,
  defaults: fullPolicy,
  writeActions: z.array(z.string()),
});

/**
 * Org rules are read by members; your own are yours.
 * @param ctx - Who runs the action
 * @param input - The scope and org
 * @param input.scope
 * @param input.orgId
 */
async function authorizeRead(ctx: ActionContext, input: z.infer<typeof target>): Promise<void> {
  if (input.scope === 'org') {
    if (!input.orgId) throw new AppError(400, 'orgId is required for scope org');
    await orgMember<typeof input>((i) => i.orgId as string)(ctx, input);
  } else if (input.orgId) {
    // The effective policy is computed for this org, so only a member asks
    await orgMember<typeof input>((i) => i.orgId as string)(ctx, input);
  }
}

/**
 * Only an org owner changes the org's rules; your own rules are always yours to change.
 * @param ctx - Who runs the action
 * @param input - The scope and org
 * @param input.scope
 * @param input.orgId
 */
async function authorizeWrite(ctx: ActionContext, input: z.infer<typeof target>): Promise<void> {
  if (input.scope === 'user') return;
  if (!input.orgId) throw new AppError(400, 'orgId is required for scope org');
  const membership = await prisma.orgMembership.findUnique({
    where: { userId_orgId: { userId: ctx.userId, orgId: input.orgId } },
    select: { role: true },
  });
  if (!membership) throw new AppError(403, 'Not a member of this organization', 'NOT_ORG_MEMBER');
  if (membership.role !== 'OWNER') {
    throw new AppError(403, 'Only an organization owner can change its approval rules');
  }
}

registerActions([
  defineAction({
    name: 'agentPolicy.get',
    area: 'approvals',
    kind: 'read',
    summary:
      'Read the rules that decide which token calls wait for approval, for you (scope user) or ' +
      'an organization you belong to (scope org), and what they come to',
    target,
    input: target,
    output: policyView,
    rest: { method: 'GET', path: BASE },
    authorize: authorizeRead,
    handler: (ctx, input) => getPolicy(ctx.userId, input.scope, input.orgId),
  }),
  defineAction({
    name: 'agentPolicy.update',
    orgLevel: true,
    // A token must not change its own leash, so it waits for you
    admin: true,
    area: 'approvals',
    kind: 'write',
    summary:
      'Replace the approval rules of an organization (owners only) or your own (which can only ' +
      'add approvals)',
    target,
    input: target.extend({ rules: rulesSchema }),
    output: policyView,
    preview: (ctx, input) =>
      describePolicyChange(ctx.userId, input.scope, input.orgId, input.rules),
    rest: { method: 'PUT', path: BASE },
    authorize: authorizeWrite,
    handler: (ctx, input) => savePolicy(ctx.userId, input.scope, input.orgId, input.rules),
  }),
]);
