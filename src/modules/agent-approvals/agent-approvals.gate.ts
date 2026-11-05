import { AsyncLocalStorage } from 'node:async_hooks';

import { Prisma, type AgentApproval, type AgentApprovalStatus } from '@prisma/client';

import {
  isToken,
  needsApproval,
  PendingApproval,
  type EffectivePolicy,
} from '../../actions/approval-policy';
import type { ActionContext, ActionDef } from '../../actions/define';
import { prisma } from '../../config/database';
import { containsNul } from '../../lib/text-guard';
import { AppError } from '../../middleware/errorHandler';
import { broadcastToUser } from '../../realtime/broadcast';
import { logger } from '../../utils/logger';
import { createNotification } from '../notifications/notifications.service';

import { policyForCall, rawNamedRefusal } from './agent-policy.service';

/*
 * The approval gate of executeAction, apart from the service that lists, approves and runs the
 * requests: the service runs actions through executeAction, so the gate living there made an
 * import cycle with it.
 */

const MAX_INPUT_BYTES = 256 * 1024;
const MAX_PENDING_PER_USER = 50;
const MAX_PREVIEW_LENGTH = 2000;
const CUT_MARKER = ' [cut: the full input is on the request]';
const MAX_NOTIFIED_PREVIEW_LENGTH = 250;

/**
 * The run of an approved request. It lives here and nowhere else, so nothing an adapter passes on
 * (input, context, a header) can make the gate let a call through: only approveAgentApproval
 * enters it, through runApproved, and the gate still asks the row.
 */
const approvedRun = new AsyncLocalStorage<{ approvalId: string; action: string; userId: string }>();

/**
 * Run an approved request's action as that run, so the gate lets this one call through. Only
 * approveAgentApproval calls this, after it claimed the row.
 * @param run - The request, its action and its user
 * @param run.approvalId
 * @param run.action
 * @param run.userId
 * @param fn - The call
 */
export function runApproved<T>(
  run: { approvalId: string; action: string; userId: string },
  fn: () => Promise<T>,
): Promise<T> {
  return approvedRun.run(run, fn);
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
 * The stored input of an action without a preview, with the ids an approver cannot read swapped for
 * the project key and the issue key they stand for. Other fields stay as stored.
 * @param stored - The input as stored
 */
async function readableInput(stored: Prisma.InputJsonObject): Promise<Prisma.InputJsonObject> {
  const { projectId, issueNumber, ...rest } = stored;
  if (typeof projectId !== 'string') return stored;
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { prefix: true },
  });
  if (!project) return stored;
  const number = typeof issueNumber === 'string' || typeof issueNumber === 'number';
  return number
    ? { issue: `${project.prefix}-${issueNumber}`, ...rest }
    : { project: project.prefix, ...(issueNumber === undefined ? {} : { issueNumber }), ...rest };
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
    : `Run ${def.name} (${def.summary.replace(/[\s.:;]+$/, '')}) with ${sortedJson(await readableInput(stored))}`;
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
export function announce(row: { userId: string; id: string; status: AgentApprovalStatus }): void {
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
