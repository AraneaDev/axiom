import { AsyncLocalStorage } from 'node:async_hooks';

import { Prisma, type AgentApproval, type AgentApprovalStatus } from '@prisma/client';

import {
  isToken,
  needsApproval,
  PendingApproval,
  type EffectivePolicy,
} from '../../actions/approval-policy';
import { toActError, type ActError } from '../../actions/batch';
import type { ActionContext, ActionDef } from '../../actions/define';
import { executeAction } from '../../actions/execute';
import { getAction } from '../../actions/registry';
import { prisma } from '../../config/database';
import { containsNul } from '../../lib/text-guard';
import { AppError } from '../../middleware/errorHandler';
import { broadcastToUser } from '../../realtime/broadcast';
import { logger } from '../../utils/logger';
import { createNotification } from '../notifications/notifications.service';

import { OUTCOME_UNKNOWN } from './agent-approvals.cleanup';
import { policyForCall, rawNamedRefusal } from './agent-policy.service';

const MAX_INPUT_BYTES = 256 * 1024;
const MAX_RESULT_BYTES = 1024 * 1024;
const MAX_PENDING_PER_USER = 50;
const MAX_PREVIEW_LENGTH = 2000;
const CUT_MARKER = ' [cut: the full input is on the request]';
const MAX_NOTIFIED_PREVIEW_LENGTH = 250;

export const MAX_WAIT_SECONDS = 25;
const MAX_WAITS_PER_USER = 2;
const WAIT_POLL_MS = 500;
const MAX_LIST_LIMIT = 100;

/** The columns a list shows: what a request holds is for its detail. */
const LIST_FIELDS = {
  id: true,
  action: true,
  preview: true,
  status: true,
  apiTokenName: true,
  channel: true,
  decidedAt: true,
  expiresAt: true,
  createdAt: true,
} as const;

/**
 * The run of an approved request. It lives here and nowhere else, so nothing an adapter passes on
 * (input, context, a header) can make the gate let a call through: only approveAgentApproval below
 * enters it, and the gate still asks the row.
 */
const approvedRun = new AsyncLocalStorage<{ approvalId: string; action: string; userId: string }>();

/**
 * Who reads the requests: a session sees all of its user's, a token only what it asked itself, as
 * a request can hold what the scopes of another token cover.
 * @param ctx - Who runs the action
 */
function ownedBy(ctx: ActionContext): Prisma.AgentApprovalWhereInput {
  return ctx.apiTokenId === undefined
    ? { userId: ctx.userId }
    : { userId: ctx.userId, apiTokenId: ctx.apiTokenId };
}

/**
 * Whether this call is the run of a request that was approved.
 * @param def - The action
 * @param ctx - Who runs it
 */
async function isApprovedRun(def: ActionDef, ctx: ActionContext): Promise<boolean> {
  const run = approvedRun.getStore();
  if (!run || run.action !== def.name || run.userId !== ctx.userId) return false;
  const row = await prisma.agentApproval.findFirst({
    where: { id: run.approvalId, userId: ctx.userId, action: def.name, status: 'APPROVED' },
    select: { id: true },
  });
  return row !== null;
}

/**
 * What a request stores of the input as given: the fields the action takes, so the run reads them
 * as this call did and the approver sees nothing that does no work.
 * @param def - The action
 * @param rawInput - Its input, not yet transformed: a validated one need not validate again
 * @returns JSON that validates like the input did
 */
function storedInput(def: ActionDef, rawInput: unknown): Prisma.InputJsonObject {
  const given = (rawInput ?? {}) as Record<string, unknown>;
  const { shape } = def.input as { shape?: Record<string, unknown> };
  const kept = shape
    ? Object.fromEntries(Object.entries(given).filter(([field]) => Object.hasOwn(shape, field)))
    : given;
  return JSON.parse(JSON.stringify(kept)) as Prisma.InputJsonObject;
}

/**
 * JSON with its keys sorted at every level, so what the agent puts first decides nothing about what
 * is left after a cut.
 * @param value - JSON
 */
function sortedJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item).sort(([left], [right]) =>
            left < right ? -1 : left > right ? 1 : 0,
          ),
        )
      : item,
  );
}

/**
 * The text an approver reads. Plain text, built by the server. A cut says so.
 * @param def - The action
 * @param input - Its validated input
 * @param stored - Its input as stored
 * @param ctx - Who runs it
 */
async function previewOf(
  def: ActionDef,
  input: unknown,
  stored: Prisma.InputJsonObject,
  ctx: ActionContext,
): Promise<string> {
  const text = def.preview
    ? await def.preview(ctx, input)
    : `Run ${def.name} (${def.summary.replace(/[\s.:;]+$/, '')}) with ${sortedJson(stored)}`;
  return text.length > MAX_PREVIEW_LENGTH
    ? text.slice(0, MAX_PREVIEW_LENGTH - CUT_MARKER.length) + CUT_MARKER
    : text;
}

/**
 * Tell a user's open pages that a request changed.
 * @param row - The request
 * @param row.userId
 * @param row.id
 * @param row.status
 */
function announce(row: { userId: string; id: string; status: AgentApprovalStatus }): void {
  broadcastToUser(row.userId, {
    type: 'agent:approval',
    userId: row.userId,
    approvalId: row.id,
    status: row.status,
  });
}

/**
 * Store a request, holding the cap per user. The lock is what holds it under parallel calls: an
 * agent could otherwise flood the table past any count it just read.
 * @param data - The row
 * @throws {AppError} 429 past MAX_PENDING_PER_USER
 */
function createWithinCap(data: Prisma.AgentApprovalUncheckedCreateInput): Promise<AgentApproval> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`agent-approval:${data.userId}`}, 0))`;
    const pending = await tx.agentApproval.count({
      where: { userId: data.userId, status: 'PENDING', expiresAt: { gt: new Date() } },
    });
    if (pending >= MAX_PENDING_PER_USER) {
      throw new AppError(
        429,
        `You have ${MAX_PENDING_PER_USER} requests waiting for approval: wait until some are decided`,
        'RATE_LIMITED',
      );
    }
    return tx.agentApproval.create({ data });
  });
}

/**
 * A preview as a notification title holds it.
 * @param preview - The preview
 */
function notifiedPreview(preview: string): string {
  return preview.length > MAX_NOTIFIED_PREVIEW_LENGTH
    ? `${preview.slice(0, MAX_NOTIFIED_PREVIEW_LENGTH)}...`
    : preview;
}

/**
 * Create the request a call waits on, and tell its user.
 * @param def - The action
 * @param rawInput - Its input as given
 * @param input - Its validated input
 * @param ctx - Who runs it
 * @param policy - The policy of the caller
 * @throws {AppError} 400 for a raw binding or an input past the cap, 429 past the cap per user
 */
async function requestApproval(
  def: ActionDef,
  rawInput: unknown,
  input: unknown,
  ctx: ActionContext,
  policy: EffectivePolicy,
): Promise<PendingApproval> {
  if (def.rest?.raw) {
    // Only a rule that names it gets here (registry rules keep the others out). It can't be queued
    throw rawNamedRefusal(def.name);
  }
  const stored = storedInput(def, rawInput);
  // An action that reads its own text is past the check in runAction, and jsonb refuses NUL
  if (containsNul(stored)) {
    throw new AppError(400, 'Text may not contain a NUL character', 'INVALID_TEXT');
  }
  if (Buffer.byteLength(JSON.stringify(stored)) > MAX_INPUT_BYTES) {
    throw new AppError(400, 'This request is too large to wait for approval', 'INPUT_TOO_LARGE');
  }
  const preview = await previewOf(def, input, stored, ctx);
  const row = await createWithinCap({
    userId: ctx.userId,
    apiTokenId: ctx.apiTokenId,
    apiTokenName: ctx.apiTokenName,
    channel: ctx.channel,
    action: def.name,
    input: stored,
    preview,
    expiresAt: new Date(Date.now() + policy.expiresMinutes * 60_000),
  });
  const approveUrl = `/approvals/agent/${row.id}`;
  // The request stands whether or not telling about it works: it is in the user's list
  try {
    await createNotification(
      ctx.userId,
      'agent:approval',
      `${ctx.apiTokenName ?? 'An agent'} wants to: ${notifiedPreview(preview)}`,
      undefined,
      approveUrl,
    );
  } catch (err) {
    logger.error('telling about an agent approval failed', { id: row.id }, err as Error);
  }
  try {
    announce(row);
  } catch (err) {
    logger.error('announcing an agent approval failed', { id: row.id }, err as Error);
  }
  return new PendingApproval({
    status: 'pending_approval',
    approvalId: row.id,
    preview,
    expiresAt: row.expiresAt.toISOString(),
    approveUrl,
    next:
      `Nothing ran yet: your user decides at approveUrl. Run agentApproval.wait with id ` +
      `${row.id} to learn the outcome; that needs the approvals:read scope.`,
  });
}

/**
 * The approval gate of executeAction: after authorize, before the handler.
 * @param def - The action
 * @param rawInput - Its input as given
 * @param input - Its validated input
 * @param ctx - Who runs it
 * @returns What the caller reads instead of a result, or undefined when the handler may run
 */
export async function approvalGate(
  def: ActionDef,
  rawInput: unknown,
  input: unknown,
  ctx: ActionContext,
): Promise<PendingApproval | undefined> {
  if (!isToken(ctx)) return undefined;
  // A read can't need approval, so it costs no lookups
  if (def.kind === 'read' && !def.admin) return undefined;
  const policy = await policyForCall(def, ctx, input);
  if (!(await needsApproval(def, input, ctx, policy))) return undefined;
  if (await isApprovedRun(def, ctx)) return undefined;
  return requestApproval(def, rawInput, input, ctx, policy);
}

/**
 * A request as its readers see it: one past its expiry reads as expired before the worker marks it.
 * @param row - The row
 */
function view<T extends { status: AgentApprovalStatus; expiresAt: Date }>(row: T): T {
  return row.status === 'PENDING' && row.expiresAt <= new Date()
    ? { ...row, status: 'EXPIRED' }
    : row;
}

/**
 * The condition for a status, taking a request past its expiry for expired.
 * @param status - The status asked for
 */
function statusWhere(status: AgentApprovalStatus): Prisma.AgentApprovalWhereInput {
  const now = new Date();
  if (status === 'PENDING') return { status, expiresAt: { gt: now } };
  if (status === 'EXPIRED') {
    return { OR: [{ status }, { status: 'PENDING', expiresAt: { lte: now } }] };
  }
  return { status };
}

/**
 * List requests, newest first, without what they hold.
 * @param ctx - Who reads
 * @param opts - The filter and the window
 * @param opts.status - Only this status
 * @param opts.limit - At most this many, up to MAX_LIST_LIMIT
 * @param opts.offset - Skip this many
 */
export async function listAgentApprovals(
  ctx: ActionContext,
  opts: { status?: AgentApprovalStatus; limit?: number; offset?: number },
) {
  const where = { ...ownedBy(ctx), ...(opts.status ? statusWhere(opts.status) : {}) };
  const take = Math.min(Math.max(opts.limit ?? MAX_LIST_LIMIT, 1), MAX_LIST_LIMIT);
  const skip = opts.offset ?? 0;
  const [rows, total] = await Promise.all([
    prisma.agentApproval.findMany({
      where,
      select: LIST_FIELDS,
      orderBy: { createdAt: 'desc' },
      take,
      skip,
    }),
    prisma.agentApproval.count({ where }),
  ]);
  return { data: rows.map(view), total, limit: take, offset: skip };
}

/**
 * One request.
 * @param id - Its id
 * @param ctx - Who reads
 * @throws {AppError} 404 unless it is the caller's
 */
export async function getAgentApproval(id: string, ctx: ActionContext) {
  const row = await prisma.agentApproval.findFirst({ where: { id, ...ownedBy(ctx) } });
  if (!row) throw new AppError(404, 'Approval request not found');
  return view(row);
}

/** Long polls running now, per user. Per process: there is one API container (Architecture). */
const activeWaits = new Map<string, number>();

/**
 * Answer once a request has an outcome, or with its current status when the time is up.
 * @param id - Its id
 * @param ctx - Who waits
 * @param seconds - How long at most
 * @throws {AppError} 404 unless it is the caller's, 429 past MAX_WAITS_PER_USER
 */
export async function waitForAgentApproval(
  id: string,
  ctx: ActionContext,
  seconds: number = MAX_WAIT_SECONDS,
) {
  const active = activeWaits.get(ctx.userId) ?? 0;
  if (active >= MAX_WAITS_PER_USER) {
    throw new AppError(429, 'Too many waits at once, please try again later', 'RATE_LIMITED');
  }
  activeWaits.set(ctx.userId, active + 1);
  try {
    const deadline = Date.now() + Math.min(seconds, MAX_WAIT_SECONDS) * 1000;
    for (;;) {
      const row = await getAgentApproval(id, ctx);
      // APPROVED is the run in progress: its outcome is what the agent waits for
      const open = row.status === 'PENDING' || row.status === 'APPROVED';
      const left = deadline - Date.now();
      if (!open || left <= 0) return row;
      await new Promise((resolve) => setTimeout(resolve, Math.min(WAIT_POLL_MS, left)));
    }
  } finally {
    const remaining = (activeWaits.get(ctx.userId) ?? 1) - 1;
    if (remaining > 0) activeWaits.set(ctx.userId, remaining);
    else activeWaits.delete(ctx.userId);
  }
}

/**
 * Why a decision found nothing waiting.
 * @param id - The request
 * @param userId - Who decides
 */
async function decisionRefusal(id: string, userId: string): Promise<AppError> {
  const row = await prisma.agentApproval.findFirst({
    where: { id, userId },
    select: { status: true, expiresAt: true },
  });
  if (!row) return new AppError(404, 'Approval request not found');
  const { status } = view(row);
  return new AppError(409, `This request is ${status.toLowerCase()}`, 'ALREADY_DECIDED');
}

/**
 * Take a waiting request for this decision. Only one decision gets it, and one past its expiry
 * can't, whether or not the worker has marked it.
 * @param id - The request
 * @param userId - Who decides
 * @param status - The decision
 * @throws {AppError} 404 unless it is theirs, 409 when nothing waits anymore
 */
async function claim(
  id: string,
  userId: string,
  status: 'APPROVED' | 'REJECTED',
): Promise<AgentApproval> {
  const now = new Date();
  const { count } = await prisma.agentApproval.updateMany({
    where: { id, userId, status: 'PENDING', expiresAt: { gt: now } },
    data: { status, decidedAt: now },
  });
  if (count === 0) throw await decisionRefusal(id, userId);
  const row = await prisma.agentApproval.findUniqueOrThrow({ where: { id } });
  announce(row);
  return row;
}

/**
 * Who a run acts as: the user and the token that asked, with the token's scopes as they are now and
 * the original channel, so the audit log says via and names this request. byName makes the run
 * audit per action, as the row the adapter would have written is for the approve request instead.
 * @param row - The request
 * @returns The context, or undefined when the token is gone or expired
 */
async function contextOfRun(row: AgentApproval): Promise<ActionContext | undefined> {
  if (!row.apiTokenId) return undefined;
  const token = await prisma.apiToken.findFirst({
    where: { id: row.apiTokenId, userId: row.userId },
    select: { name: true, scopes: true, expiresAt: true },
  });
  if (!token || (token.expiresAt && token.expiresAt <= new Date())) return undefined;
  return {
    userId: row.userId,
    apiTokenId: row.apiTokenId,
    apiTokenName: row.apiTokenName ?? token.name,
    scopes: token.scopes,
    channel: row.channel as ActionContext['channel'],
    byName: {},
    approvalRunId: row.id,
  };
}

/**
 * Close a run that failed.
 * @param id - The request
 * @param error - What the approver and the agent read
 */
async function finishFailed(id: string, error: ActError): Promise<AgentApproval> {
  const row = await prisma.agentApproval.update({
    where: { id },
    data: { status: 'FAILED', error },
  });
  announce(row);
  return row;
}

/**
 * Close a run that ended. What is stored passes through the action's redactResult, so a secret
 * stays in the approver's answer.
 * @param row - The request
 * @param result - What the handler returned
 */
async function finishRun(row: AgentApproval, result: unknown) {
  if (result instanceof PendingApproval) {
    return finishFailed(row.id, {
      status: 409,
      code: 'NOT_APPROVED',
      message: 'This request was no longer approved when it ran',
    });
  }
  const def = getAction(row.action);
  const redacted: unknown = def?.redactResult ? def.redactResult(result) : result;
  const json = JSON.stringify(redacted ?? null);
  if (Buffer.byteLength(json) > MAX_RESULT_BYTES) {
    return finishFailed(row.id, {
      status: 413,
      code: 'RESULT_TOO_LARGE',
      message: 'The action ran, but its result is too large to store',
    });
  }
  const done = await prisma.agentApproval.update({
    where: { id: row.id },
    data: {
      status: 'EXECUTED',
      result: result === undefined ? Prisma.DbNull : (JSON.parse(json) as Prisma.InputJsonValue),
    },
  });
  announce(done);
  // The one place the unredacted result goes: the person who approved it
  return { ...done, result: result ?? null };
}

/**
 * Approve a request and run its action as the user and token that asked, with their rights now.
 * The run's outcome is in the row, so an action refused or failing still answers 200 with FAILED.
 * Whatever goes wrong around the run leaves FAILED OUTCOME_UNKNOWN, as the action may have run: it
 * never runs again. If even that can't be written, the worker closes the row.
 * @param id - The request
 * @param userId - Who approves
 * @throws {AppError} 404 unless it is theirs, 409 when nothing waits anymore
 */
export async function approveAgentApproval(id: string, userId: string) {
  const row = await claim(id, userId, 'APPROVED');
  try {
    const ctx = await contextOfRun(row);
    if (!ctx) {
      return await finishFailed(id, {
        status: 403,
        code: 'TOKEN_REVOKED',
        message: 'The token that asked for this was revoked or has expired',
      });
    }
    let result: unknown;
    try {
      result = await approvedRun.run({ approvalId: id, action: row.action, userId }, () =>
        executeAction(row.action, row.input, ctx),
      );
    } catch (err) {
      return await finishFailed(id, toActError(err));
    }
    return await finishRun(row, result);
  } catch (err) {
    logger.error('closing an approved run failed', { id }, err as Error);
    return finishFailed(id, OUTCOME_UNKNOWN);
  }
}

/**
 * Reject a request. Its action never runs.
 * @param id - The request
 * @param userId - Who rejects
 * @throws {AppError} 404 unless it is theirs, 409 when nothing waits anymore
 */
export function rejectAgentApproval(id: string, userId: string): Promise<AgentApproval> {
  return claim(id, userId, 'REJECTED');
}
