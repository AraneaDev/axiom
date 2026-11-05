import { runWithRequestContext } from '../lib/request-context';
import { loggableExternalUrl } from '../lib/request-path';
import { AppError } from '../middleware/errorHandler';
import { logAudit } from '../modules/audit/audit.service';
import { logger } from '../utils/logger';

import type { ActionContext, ActionDef } from './define';

/** Fields of an action's input that name what it works on. */
const TARGET_FIELD = /^id$|^slug$|Id$|Number$|Slug$/;
/** Anything with a scheme, whichever field it is in: a URL's query can hold a credential. */
const URL_LIKE = /^[a-z][a-z0-9+.-]*:\/\//i;
const MAX_VALUE_LENGTH = 200;
const MAX_LIST_ITEMS = 50;
/** The most a row's target holds, whatever a caller sent. */
const MAX_TARGET_LENGTH = 2000;

type TargetValue = string | number | Array<string | number>;
type Target = Record<string, TargetValue | boolean>;

/**
 * A scalar as the log may hold it: bounded, and without what Postgres refuses in JSON.
 * @param value - The value
 */
function cleanScalar(value: unknown): string | number | undefined {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    if (URL_LIKE.test(value)) return loggableExternalUrl(value).slice(0, MAX_VALUE_LENGTH);
    return value
      .slice(0, MAX_VALUE_LENGTH * 2)
      .replace(/\p{Cc}/gu, '')
      .slice(0, MAX_VALUE_LENGTH);
  }
  return undefined;
}

/**
 * Add one field, leaving out what isn't a scalar or a list of them. A list keeps its length.
 * @param target - The target so far
 * @param field - The name in the row
 * @param value - The value, as given
 */
function addField(target: Target, field: string, value: unknown): void {
  if (Array.isArray(value)) {
    const items = value
      .slice(0, MAX_LIST_ITEMS)
      .map(cleanScalar)
      .filter((item) => item !== undefined);
    target[field] = items;
    target[`${field}Count`] = value.length;
    return;
  }
  const scalar = cleanScalar(value);
  if (scalar !== undefined) target[field] = scalar;
}

/**
 * The value at a dotted path of own properties.
 * @param source - An input or a result, of any shape
 * @param path - For example target.issueKey
 */
function valueAt(source: unknown, path: string): unknown {
  let value = source;
  for (const part of path.split('.')) {
    if (typeof value !== 'object' || value === null || !Object.hasOwn(value, part))
      return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

/**
 * The fields of a schema, when it is an object.
 * @param schema - The target or input schema
 */
function shapeFields(schema: unknown): string[] {
  const { shape } = (schema ?? {}) as { shape?: Record<string, unknown> };
  return shape ? Object.keys(shape) : [];
}

/**
 * What a row says the action worked on. Only names the action itself declares are read, so what a
 * caller adds to the input never reaches the log: the id fields of its schemas, its `auditFields`,
 * and the id of what it returned.
 * @param def - The action
 * @param rawInput - Its input as given, possibly from a refused caller
 * @param result - What it returned, if it ran
 * @param key - The key it was addressed by, when it stopped there
 */
function targetOf(def: ActionDef, rawInput: unknown, result: unknown, key?: string): Target {
  const target: Target = {};
  const idFields = [...shapeFields(def.target), ...shapeFields(def.input)].filter((field) =>
    TARGET_FIELD.test(field),
  );
  for (const field of new Set(idFields)) addField(target, field, valueAt(rawInput, field));
  for (const path of def.auditFields?.input ?? []) {
    addField(target, path.split('.').pop() as string, valueAt(rawInput, path));
  }
  if (key !== undefined) addField(target, 'key', key);
  addField(target, 'resultId', valueAt(result, 'id'));
  for (const path of def.auditFields?.result ?? []) {
    addField(target, path.split('.').pop() as string, valueAt(result, path));
  }
  return JSON.stringify(target).length <= MAX_TARGET_LENGTH ? target : shrink(target);
}

/**
 * A target past the cap: scalars stay in order until it is full.
 * @param target - The target
 */
function shrink(target: Target): Target {
  const kept: Target = { truncated: true };
  for (const [field, value] of Object.entries(target)) {
    const next = { ...kept, [field]: value };
    if (JSON.stringify(next).length <= MAX_TARGET_LENGTH) kept[field] = value;
  }
  return kept;
}

/**
 * How an action ended.
 * @param err - What it threw, if anything
 * @param approvalId - The request it waits on instead of having run, if any
 */
function outcomeOf(err: unknown, approvalId?: string) {
  if (approvalId !== undefined) return { outcome: 'pending_approval', approvalId };
  if (err === undefined) return { outcome: 'ok' };
  if (err instanceof AppError && err.statusCode < 500) {
    return { outcome: 'refused', status: err.statusCode, code: err.code ?? 'ERROR' };
  }
  return { outcome: 'failed', status: 500, code: 'INTERNAL_ERROR' };
}

/**
 * Whether this caller's writes are audited per action. These adapters answer many actions on one
 * path, so a row per request would say neither what ran nor how it ended (R21).
 * @param ctx - Who runs the action
 */
export function auditedPerAction(ctx: ActionContext): boolean {
  return ctx.channel === 'mcp' || ctx.byName !== undefined;
}

/**
 * Write a row. A failure to write it is logged and changes nothing about the answer.
 * @param action - The row's action
 * @param resourceType - The row's resource
 * @param target - What was worked on
 * @param ctx - Who ran it
 * @param err - What it threw, if anything
 * @param approvalId - The request it waits on instead of having run, if any
 */
async function writeRow(
  action: string,
  resourceType: string,
  target: Record<string, unknown>,
  ctx: ActionContext,
  err: unknown,
  approvalId?: string,
): Promise<void> {
  const requestCtx = {
    userId: ctx.userId,
    apiTokenId: ctx.apiTokenId,
    apiTokenName: ctx.apiTokenName,
    channel: ctx.channel,
  };
  try {
    await runWithRequestContext(requestCtx, () =>
      logAudit({
        userId: ctx.userId,
        action,
        resourceType,
        ipAddress: ctx.byName?.ipAddress ?? ctx.ipAddress,
        details: {
          target,
          channel: ctx.channel,
          ...outcomeOf(err, approvalId),
          ...(ctx.approvalRunId ? { approvalId: ctx.approvalRunId } : {}),
        },
      }),
    );
  } catch (auditError) {
    logger.error('writing an action audit row failed', { action }, auditError as Error);
  }
}

/**
 * The audit row of one write action, done or refused. Reads aren't audited, as over REST. A request
 * that waits for approval is always written here, on every channel and for a read too, as no other
 * row would say what it is.
 * @param def - The action
 * @param rawInput - Its input as given
 * @param ctx - Who ran it
 * @param outcome - How it ended
 * @param outcome.err - What it threw, if anything
 * @param outcome.result - What it returned, if it ran
 * @param outcome.key - The key it was addressed by, when it stopped there
 * @param outcome.approvalId - The request it waits on, when it has not run
 */
export async function auditAction(
  def: ActionDef,
  rawInput: unknown,
  ctx: ActionContext,
  outcome: { err?: unknown; result?: unknown; key?: string; approvalId?: string } = {},
): Promise<void> {
  const pending = outcome.approvalId !== undefined;
  if (!pending && (def.kind !== 'write' || !auditedPerAction(ctx))) return;
  const target = targetOf(def, rawInput, outcome.result, outcome.key);
  await writeRow(def.name, def.area, target, ctx, outcome.err, outcome.approvalId);
}

/**
 * The one row of a batch refused as a whole, when it holds a write. One row, so being past the
 * limit can't write 25 per request.
 * @param writes - The names of its write actions, of any length
 * @param items - How many items it holds
 * @param ctx - Who sent it
 * @param err - The refusal
 */
export async function auditRefusedBatch(
  writes: string[],
  items: number,
  ctx: ActionContext,
  err: unknown,
): Promise<void> {
  if (writes.length === 0 || !auditedPerAction(ctx)) return;
  const actions = [...new Set(writes.slice(0, MAX_LIST_ITEMS))].slice(0, 10);
  await writeRow('act.batch', 'act', { items, actions }, ctx, err);
}
