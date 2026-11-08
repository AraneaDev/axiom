import { Prisma, type AgentApproval, type AgentApprovalStatus } from '@prisma/client';

import { PendingApproval } from '../../actions/approval-policy';
import { toActError, type ActError } from '../../actions/batch';
import type { ActionContext } from '../../actions/define';
import { executeAction } from '../../actions/execute';
import { getAction } from '../../actions/registry';
import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { logger } from '../../utils/logger';
import { isPerson } from '../service-accounts/person';

import { OUTCOME_UNKNOWN } from './agent-approvals.cleanup';
import { announce, runApproved } from './agent-approvals.gate';

const MAX_RESULT_BYTES = 1024 * 1024;

export const MAX_WAIT_SECONDS = 25;
const MAX_WAITS_PER_USER = 2;
const WAIT_POLL_MS = 500;
const MAX_LIST_LIMIT = 100;

/** The columns a list shows: what a request holds is for its detail. */
const LIST_FIELDS = {
  id: true,
  userId: true,
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
 * The bots a person owns, by id with their names: their requests are the owner's to decide.
 * @param userId - The person
 */
async function ownedBots(userId: string): Promise<Map<string, string>> {
  const rows = await prisma.serviceAccountOwner.findMany({
    where: { ownerId: userId },
    select: {
      serviceAccountId: true,
      serviceAccount: { select: { user: { select: { displayName: true } } } },
    },
  });
  return new Map(rows.map((r) => [r.serviceAccountId, r.serviceAccount.user.displayName]));
}

/** Who reads and decides requests, and the bots whose requests count among them. */
interface Reader {
  where: Prisma.AgentApprovalWhereInput;
  bots: Map<string, string>;
}

/**
 * Who reads the requests: a session sees all of its user's and those of every bot the user owns,
 * a token only what it asked itself, as a request can hold what the scopes of another token cover.
 * @param ctx - Who runs the action
 */
async function readerOf(ctx: ActionContext): Promise<Reader> {
  if (ctx.apiTokenId !== undefined) {
    return { where: { userId: ctx.userId, apiTokenId: ctx.apiTokenId }, bots: new Map() };
  }
  return deciderOf(ctx.userId);
}

/**
 * Whose requests a person decides: their own and those of the bots they own. Approving and
 * rejecting are web UI only, so this is always a session.
 * @param userId - The person
 */
async function deciderOf(userId: string): Promise<Reader> {
  const bots = await ownedBots(userId);
  const where: Prisma.AgentApprovalWhereInput =
    bots.size === 0 ? { userId } : { userId: { in: [userId, ...bots.keys()] } };
  return { where, bots };
}

/**
 * A request as its reader sees it: one of a bot they own names the bot.
 * @param row - The row
 * @param bots - The reader's bots
 */
function marked<T extends { userId: string }>(row: T, bots: Map<string, string>) {
  const name = bots.get(row.userId);
  return name === undefined
    ? row
    : { ...row, serviceAccount: { id: row.userId, displayName: name } };
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
 * Open requests wait and have not expired; decided is everything else, a lapsed one included.
 * @param state - open or decided
 */
function stateWhere(state: 'open' | 'decided'): Prisma.AgentApprovalWhereInput {
  const open = statusWhere('PENDING');
  return state === 'open' ? open : { NOT: open };
}

/**
 * List requests, newest first, without what they hold.
 * @param ctx - Who reads
 * @param opts - The filter and the window
 * @param opts.status - Only this status
 * @param opts.state - Only open or only decided ones
 * @param opts.limit - At most this many, up to MAX_LIST_LIMIT
 * @param opts.offset - Skip this many
 */
export async function listAgentApprovals(
  ctx: ActionContext,
  opts: {
    status?: AgentApprovalStatus;
    state?: 'open' | 'decided';
    limit?: number;
    offset?: number;
  },
) {
  const reader = await readerOf(ctx);
  const where: Prisma.AgentApprovalWhereInput = {
    AND: [
      reader.where,
      opts.status ? statusWhere(opts.status) : {},
      opts.state ? stateWhere(opts.state) : {},
    ],
  };
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
  return {
    data: rows.map((row) => marked(view(row), reader.bots)),
    total,
    limit: take,
    offset: skip,
  };
}

/**
 * One request.
 * @param id - Its id
 * @param ctx - Who reads
 * @throws {AppError} 404 unless it is the caller's
 */
export async function getAgentApproval(id: string, ctx: ActionContext) {
  const reader = await readerOf(ctx);
  const row = await prisma.agentApproval.findFirst({ where: { AND: [{ id }, reader.where] } });
  if (!row) throw new AppError(404, 'Approval request not found');
  return marked(view(row), reader.bots);
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
 * @param decider - Whose requests the caller decides
 */
async function decisionRefusal(id: string, decider: Reader): Promise<AppError> {
  const row = await prisma.agentApproval.findFirst({
    where: { AND: [{ id }, decider.where] },
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
 * @param userId - Who decides: the user who asked, or an owner of the bot that did
 * @param status - The decision
 * @throws {AppError} 404 unless it is theirs to decide, 409 when nothing waits anymore
 */
async function claim(
  id: string,
  userId: string,
  status: 'APPROVED' | 'REJECTED',
): Promise<AgentApproval> {
  const now = new Date();
  const decider = await deciderOf(userId);
  const { count } = await prisma.agentApproval.updateMany({
    where: { AND: [{ id, status: 'PENDING', expiresAt: { gt: now } }, decider.where] },
    data: { status, decidedAt: now },
  });
  if (count === 0) throw await decisionRefusal(id, decider);
  const row = await prisma.agentApproval.findUniqueOrThrow({ where: { id } });
  await announce(row);
  return row;
}

/**
 * Why a bot's approved request can't run: a bot deleted, suspended or deactivated since does
 * nothing, whoever approves. Undefined for a person, and for a bot that may run.
 * @param userId - Who asked
 */
async function botRefusal(userId: string): Promise<ActError | undefined> {
  if (await isPerson(userId)) return undefined;
  const bot = await prisma.serviceAccount.findUnique({
    where: { userId },
    select: { status: true, user: { select: { deactivatedAt: true } } },
  });
  if (!bot) {
    return {
      status: 403,
      code: 'SERVICE_ACCOUNT_NOT_FOUND',
      message: 'The service account that asked for this was deleted',
    };
  }
  if (bot.status === 'SUSPENDED') {
    return {
      status: 403,
      code: 'SERVICE_ACCOUNT_SUSPENDED',
      message: 'The service account that asked for this is suspended',
    };
  }
  if (bot.user.deactivatedAt) {
    return {
      status: 403,
      code: 'SERVICE_ACCOUNT_DEACTIVATED',
      message: 'The service account that asked for this is deactivated',
    };
  }
  return undefined;
}

/**
 * Close a request that may not run anymore, so it never does.
 * @param id - The request
 * @param error - Why
 */
async function finishCancelled(id: string, error: ActError): Promise<AgentApproval> {
  const row = await prisma.agentApproval.update({
    where: { id },
    data: { status: 'CANCELLED', error },
  });
  await announce(row);
  return row;
}

/**
 * Who a run acts as: the user and the token that asked, with the token's scopes as they are now and
 * the original channel, so the audit log says via and names this request. byName makes the run
 * audit per action, as the row the adapter would have written is for the approve request instead.
 * @param row - The request
 * @param approvedById - Who approved it, for the audit row
 * @returns The context, or undefined when the token is gone or expired
 */
async function contextOfRun(
  row: AgentApproval,
  approvedById: string,
): Promise<ActionContext | undefined> {
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
    approvedById,
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
  await announce(row);
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
  await announce(done);
  // The one place the unredacted result goes: the person who approved it
  return { ...done, result: result ?? null };
}

/**
 * Approve a request and run its action as the user and token that asked, with their rights now.
 * A bot's request is approved by one of its owners and runs as the bot, never as the owner; one
 * whose bot was deleted, suspended or deactivated since ends CANCELLED and never runs.
 * The run's outcome is in the row, so an action refused or failing still answers 200 with FAILED.
 * Whatever goes wrong around the run leaves FAILED OUTCOME_UNKNOWN, as the action may have run: it
 * never runs again. If even that can't be written, the worker closes the row.
 * @param id - The request
 * @param userId - Who approves
 * @throws {AppError} 404 unless it is theirs to decide, 409 when nothing waits anymore
 */
export async function approveAgentApproval(id: string, userId: string) {
  const row = await claim(id, userId, 'APPROVED');
  try {
    const refusal = await botRefusal(row.userId);
    if (refusal) return await finishCancelled(id, refusal);
    const ctx = await contextOfRun(row, userId);
    if (!ctx) {
      return await finishFailed(id, {
        status: 403,
        code: 'TOKEN_REVOKED',
        message: 'The token that asked for this was revoked or has expired',
      });
    }
    let result: unknown;
    try {
      result = await runApproved({ approvalId: id, action: row.action, userId: row.userId }, () =>
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
 * @throws {AppError} 404 unless it is theirs to decide, 409 when nothing waits anymore
 */
export function rejectAgentApproval(id: string, userId: string): Promise<AgentApproval> {
  return claim(id, userId, 'REJECTED');
}
