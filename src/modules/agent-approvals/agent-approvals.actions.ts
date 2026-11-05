import { z } from 'zod';

import { defineAction, type ActionContext } from '../../actions/define';
import { registerActions } from '../../actions/registry';
import { strictInt } from '../../utils/validation/common-validators';

import * as approvalsService from './agent-approvals.service';

const BASE = '/api/agent-approvals';

const id = z.string().min(1).max(64);
const approvalTarget = z.object({ id });
const noTarget = z.object({});

const request = z.looseObject({ id: z.string(), status: z.string() });

/**
 * Throw unless the caller may see the request: a stranger's and a missing one answer alike.
 * @param ctx - Who runs the action
 * @param target - The request's id
 * @param target.id
 */
async function authorizeOwn(ctx: ActionContext, target: { id: string }): Promise<void> {
  await approvalsService.getAgentApproval(target.id, ctx);
}

const agentApprovalActions = [
  defineAction({
    name: 'agentApproval.list',
    area: 'approvals',
    kind: 'read',
    summary: 'List your requests that wait or waited for approval, newest first',
    target: noTarget,
    input: noTarget.extend({
      status: z
        .enum(['PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'EXECUTED', 'FAILED'])
        .optional(),
      state: z
        .enum(['open', 'decided'])
        .optional()
        .describe('open: waiting and not expired; decided: everything else'),
      limit: strictInt.optional().describe('At most 100, the default'),
      offset: strictInt.optional(),
    }),
    output: z.looseObject({ data: z.array(request), total: z.number() }),
    rest: { method: 'GET', path: BASE },
    authorize: () => Promise.resolve(),
    handler: (ctx, opts) => approvalsService.listAgentApprovals(ctx, opts),
  }),
  defineAction({
    name: 'agentApproval.get',
    area: 'approvals',
    kind: 'read',
    summary: 'Read one request for approval, with its input and outcome',
    input: approvalTarget,
    output: request,
    rest: { method: 'GET', path: `${BASE}/:id` },
    authorize: authorizeOwn,
    handler: (ctx, input) => approvalsService.getAgentApproval(input.id, ctx),
  }),
  defineAction({
    name: 'agentApproval.wait',
    area: 'approvals',
    kind: 'read',
    summary:
      'Wait up to 25 seconds for the outcome of a request for approval. Answers its current ' +
      'status, with the result once it is EXECUTED and the error once it is FAILED. Call it ' +
      'again while it says PENDING',
    target: approvalTarget,
    input: approvalTarget.extend({
      seconds: strictInt.optional().describe('How long at most: 25, the default, is the limit'),
    }),
    output: request,
    rest: { method: 'GET', path: `${BASE}/:id/wait` },
    authorize: authorizeOwn,
    handler: (ctx, input) => approvalsService.waitForAgentApproval(input.id, ctx, input.seconds),
  }),
  defineAction({
    name: 'agentApproval.approve',
    uiOnly: true,
    area: 'approvals',
    kind: 'write',
    summary: 'Approve a request and run its action. Only you, in the web UI',
    input: approvalTarget,
    output: request,
    rest: { method: 'POST', path: `${BASE}/:id/approve`, status: 200, emptyBody: true },
    authorize: authorizeOwn,
    handler: (ctx, input) => approvalsService.approveAgentApproval(input.id, ctx.userId),
  }),
  defineAction({
    name: 'agentApproval.reject',
    uiOnly: true,
    area: 'approvals',
    kind: 'write',
    summary: 'Reject a request, so its action never runs. Only you, in the web UI',
    input: approvalTarget,
    output: request,
    rest: { method: 'POST', path: `${BASE}/:id/reject`, status: 200, emptyBody: true },
    authorize: authorizeOwn,
    handler: (ctx, input) => approvalsService.rejectAgentApproval(input.id, ctx.userId),
  }),
];

registerActions(agentApprovalActions);
