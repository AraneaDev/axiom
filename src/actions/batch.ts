import type { Request, Response } from 'express';
import { z, ZodError } from 'zod';

import { AppError } from '../middleware/errorHandler';
import { perUserLimit } from '../middleware/rate-limit';
import { logger } from '../utils/logger';
import { validate } from '../utils/validation/common-validators';

import { PendingApproval, type PendingApprovalBody } from './approval-policy';
import { auditAction, auditRefusedBatch } from './audit';
import type { ActionContext, ActionDef } from './define';
import { assertRunnable, executeAction } from './execute';
import { MAX_KEY_LENGTH, parseKey, resolveContainerKey, resolveKey } from './keys';
import { getAction } from './registry';
import { actionContextFromRequest } from './rest';

/** The most items in one batch. */
export const MAX_BATCH_ITEMS = 25;

/**
 * Items per user per minute, single or in a batch: an item is what costs work, so a batch is no way
 * around the limit per request.
 */
export const ACT_LIMIT = { windowMs: 60_000, max: 300 } as const;

/** Counts toward ACT_LIMIT, for each way an agent runs actions. */
export const countActItems = perUserLimit(ACT_LIMIT, 'Too many actions, please try again later');

const actItem = z.strictObject({
  action: z.string().min(1).max(200),
  key: z.string().min(1).max(MAX_KEY_LENGTH).optional(),
  input: z.record(z.string(), z.unknown()).optional(),
});

export type ActItem = z.infer<typeof actItem>;

/** One action, or a batch: the body of /api/act and the input of the act tool. */
export const actRequest = actItem.partial({ action: true }).extend({
  // The upper bound is executeBatch's, with its own code
  batch: z.array(actItem).min(1).describe(`At most ${MAX_BATCH_ITEMS} items`).optional(),
});

type ActRequest = z.infer<typeof actRequest>;

export type ActError = { status: number; code: string; message: string };

export type BatchResult =
  | { ok: true; result: unknown }
  | { ok: false; error: ActError }
  | ({ ok: false; pending: true } & PendingApprovalBody)
  | { ok: false; skipped: true };

/**
 * What a failure tells the caller. An unexpected error is logged and says nothing about itself.
 * @param err - What was thrown
 */
export function toActError(err: unknown): ActError {
  if (err instanceof AppError && err.statusCode < 500) {
    return { status: err.statusCode, code: err.code ?? 'ERROR', message: err.message };
  }
  if (err instanceof ZodError) {
    return { status: 400, code: 'VALIDATION_ERROR', message: 'Validation failed' };
  }
  logger.error('action failed', {}, err as Error);
  return { status: 500, code: 'INTERNAL_ERROR', message: 'Internal server error' };
}

type KeyKind = 'issue' | 'page' | 'space' | 'project';

/**
 * Which kind of item an action addresses, by the id fields of its input.
 * @param def - The action
 * @returns 'issue' or 'page' for an item, 'space' or 'project' for the container an action works
 * in, or undefined for an action no key can address
 */
export function keyKindOf(def: ActionDef): KeyKind | undefined {
  const shape = (def.input as { shape?: Record<string, unknown> }).shape;
  if (!shape) return undefined;
  if ('projectId' in shape && 'issueNumber' in shape) return 'issue';
  if ('spaceId' in shape && 'pageSlug' in shape) return 'page';
  if ('spaceId' in shape) return 'space';
  if ('projectId' in shape) return 'project';
  return undefined;
}

/**
 * The input of an item with its key turned into the action's id fields. Those then go through
 * executeAction as if the caller had sent them. Only someone who may run the action at all gets to
 * the lookup, so a key tells a token nothing outside its scopes.
 * @param item - The item
 * @param ctx - Who runs it
 * @throws {AppError} 400 for a key the action can't take or that disagrees with the input, and what
 * assertRunnable and resolveKey throw
 */
async function inputOf(item: ActItem, ctx: ActionContext): Promise<unknown> {
  const { action, key, input } = item;
  if (key === undefined) return input ?? {};
  const kind = keyKindOf(assertRunnable(action, ctx));
  if (!kind) throw new AppError(400, `Action ${action} does not take a key`, 'KEY_NOT_ACCEPTED');
  const ids = await idsOfKey(key, kind, action, ctx);
  for (const [field, value] of Object.entries(ids)) {
    const given = input?.[field];
    if (given !== undefined && String(given) !== String(value)) {
      throw new AppError(400, `The key and ${field} name different items`, 'KEY_CONFLICT');
    }
  }
  return { ...input, ...ids };
}

/**
 * The id fields a key stands for in an action.
 * @param key - The key
 * @param kind - What the action takes a key for
 * @param action - The action, for messages
 * @param ctx - Who runs it
 */
async function idsOfKey(
  key: string,
  kind: KeyKind,
  action: string,
  ctx: ActionContext,
): Promise<Record<string, string | number>> {
  if (kind === 'space' || kind === 'project') {
    const resolved = await resolveContainerKey(key, kind, ctx.userId);
    return resolved.kind === 'space'
      ? { spaceId: resolved.spaceId }
      : { projectId: resolved.projectId };
  }
  if (parseKey(key).kind !== kind) {
    throw new AppError(400, `Action ${action} takes the key of ${an(kind)}`, 'KEY_NOT_ACCEPTED');
  }
  const resolved = await resolveKey(key, ctx.userId);
  return resolved.kind === 'issue'
    ? { projectId: resolved.projectId, issueNumber: resolved.issueNumber }
    : { spaceId: resolved.spaceId, pageSlug: resolved.pageSlug };
}

/**
 * Run one item. A write refused while resolving its key never reaches executeAction, so its audit
 * row is written here.
 * @param item - The item
 * @param ctx - Who runs it
 */
async function runItem(item: ActItem, ctx: ActionContext): Promise<unknown> {
  let input: unknown;
  try {
    input = await inputOf(item, ctx);
  } catch (err) {
    const def = getAction(item.action);
    if (def) await auditAction(def, item.input, ctx, { err, key: item.key });
    throw err;
  }
  return executeAction(item.action, input, ctx);
}

/**
 * The kind of item with its article, for a message.
 * @param kind - The kind
 */
function an(kind: 'issue' | 'page'): string {
  return kind === 'issue' ? 'an issue' : 'a page';
}

/**
 * Run the items in order, stopping at the first failure or the first item that needs approval. Each
 * is authorized on its own and what ran before that stays done: a batch is no transaction.
 * @param items - The items
 * @param ctx - Who runs them
 * @returns A result per item, later ones skipped after a stop, and how many completed
 * @throws {AppError} 400 past MAX_BATCH_ITEMS and 429 past ACT_LIMIT, before anything runs
 */
export async function executeBatch(
  items: ActItem[],
  ctx: ActionContext,
): Promise<{ results: BatchResult[]; completed: number }> {
  try {
    if (items.length > MAX_BATCH_ITEMS) {
      throw new AppError(400, `A batch holds at most ${MAX_BATCH_ITEMS} items`, 'BATCH_TOO_LARGE');
    }
    await countActItems(ctx.userId, items.length);
  } catch (err) {
    const writes = items
      .map((item) => getAction(item.action))
      .filter((def) => def?.kind === 'write')
      .map((def) => (def as ActionDef).name);
    await auditRefusedBatch(writes, items.length, ctx, err);
    throw err;
  }

  const results: BatchResult[] = [];
  let stopped = false;
  for (const item of items) {
    if (stopped) {
      results.push({ ok: false, skipped: true });
      continue;
    }
    try {
      const result = await runItem(item, ctx);
      if (result instanceof PendingApproval) {
        stopped = true;
        results.push({ ok: false, pending: true, ...result.body });
      } else {
        results.push({ ok: true, result });
      }
    } catch (err) {
      stopped = true;
      results.push({ ok: false, error: toActError(err) });
    }
  }
  return { results, completed: results.filter((result) => result.ok).length };
}

/**
 * Run what an /api/act body or an act tool call asks for.
 * @param request - One action, or a batch
 * @param ctx - Who runs it
 * @returns The handler's result, or the batch's results
 * @throws {AppError} 400 unless it is exactly one of the two, and what the action throws
 */
export async function runAct(request: ActRequest, ctx: ActionContext): Promise<unknown> {
  const { action, key, input, batch } = request;
  if (batch) {
    if (action !== undefined || key !== undefined || input !== undefined) {
      throw new AppError(400, 'Give either action or batch, not both');
    }
    return executeBatch(batch, ctx);
  }
  if (action === undefined) throw new AppError(400, 'Give either action or batch');
  try {
    await countActItems(ctx.userId);
  } catch (err) {
    const def = getAction(action);
    if (def) await auditAction(def, input, ctx, { err, key });
    throw err;
  }
  return runItem({ action, key, input }, ctx);
}

/**
 * POST /api/act.
 * @param req - An authenticated request
 * @param res - The response
 */
export async function handleAct(req: Request, res: Response): Promise<void> {
  const ctx = { ...actionContextFromRequest(req), byName: { ipAddress: req.ip } };
  const result = await runAct(validate(actRequest, req.body), ctx);
  if (result instanceof PendingApproval) {
    res.status(202).json(result.body);
    return;
  }
  res.status(200).json(result === undefined ? { ok: true } : result);
}
