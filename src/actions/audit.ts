import { runWithRequestContext } from '../lib/request-context';
import { AppError } from '../middleware/errorHandler';
import { logAudit } from '../modules/audit/audit.service';
import { logger } from '../utils/logger';

import type { ActionContext, ActionDef } from './define';

/** Input fields that name what an action works on. No other field of a raw input is recorded. */
const TARGET_FIELD = /^id$|Id$|Number$|Slug$/;
const MAX_TARGET_VALUE = 200;

/**
 * The ids in an input, not yet validated: a refused caller wrote them, so they are bounded and
 * cleaned, and text fields stay out of the log.
 * @param rawInput - The input
 */
function targetOf(rawInput: unknown): Record<string, string | number> {
  if (typeof rawInput !== 'object' || rawInput === null) return {};
  const target: Record<string, string | number> = {};
  for (const [field, value] of Object.entries(rawInput)) {
    if (!TARGET_FIELD.test(field)) continue;
    if (typeof value === 'number') target[field] = value;
    else if (typeof value === 'string') target[field] = cleanValue(value);
  }
  return target;
}

/**
 * A value as the log may hold it: Postgres takes no NUL in JSON, and nobody needs a megabyte.
 * @param value - The value
 */
function cleanValue(value: string): string {
  return value.replace(/\p{Cc}/gu, '').slice(0, MAX_TARGET_VALUE);
}

/**
 * How an action ended.
 * @param err - What it threw, if anything
 */
function outcomeOf(err: unknown) {
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
 * The audit row of one write action, done or refused. A failure to write it is logged and changes
 * nothing about the answer. Reads aren't audited, as over REST.
 * @param def - The action
 * @param rawInput - Its input as given
 * @param ctx - Who ran it
 * @param err - What it threw, if anything
 * @param key - The key it was addressed by, when that is all there is
 */
export async function auditAction(
  def: ActionDef,
  rawInput: unknown,
  ctx: ActionContext,
  err?: unknown,
  key?: string,
): Promise<void> {
  if (def.kind !== 'write' || !auditedPerAction(ctx)) return;
  const target = { ...targetOf(rawInput), ...(key === undefined ? {} : { key: cleanValue(key) }) };
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
        action: def.name,
        resourceType: def.area,
        ipAddress: ctx.byName?.ipAddress,
        details: { target, channel: ctx.channel, ...outcomeOf(err) },
      }),
    );
  } catch (auditError) {
    logger.error('writing an action audit row failed', { action: def.name }, auditError as Error);
  }
}
