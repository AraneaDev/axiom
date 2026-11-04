import { runWithRequestContext } from '../lib/request-context';
import { containsNul } from '../lib/text-guard';
import { AppError } from '../middleware/errorHandler';
import { scopeAllows } from '../middleware/token-scopes';
import { validate } from '../utils/validation/common-validators';

import { auditAction } from './audit';
import type { ActionContext, ActionDef } from './define';
import { getAction } from './registry';

/**
 * Whether a token runs this. Each signal counts on its own and a token without scopes holds
 * none, so a context filled in wrongly is refused instead of treated as a session.
 * @param ctx - Who runs the action
 */
export function isToken(ctx: ActionContext): boolean {
  return ctx.channel !== 'ui' || ctx.apiTokenId !== undefined || ctx.scopes !== undefined;
}

/** The refusal authenticate gives a token today, so migrated routes keep their answer. */
function scopeRefusal(): AppError {
  return new AppError(403, 'This API token does not have the scope for this request', 'SCOPE');
}

/**
 * In tests, fail on a handler whose result no longer fits its output schema.
 * @param def - The action
 * @param result - What its handler returned
 */
function assertOutputShape(def: ActionDef, result: unknown): void {
  if (process.env.NODE_ENV !== 'test') return;
  const parsed = def.output.safeParse(result);
  if (!parsed.success) {
    throw new Error(
      `Action ${def.name} returned output that does not match its schema: ${parsed.error.message}`,
    );
  }
}

/**
 * Why this caller can't run this action at all, whatever its input: the checks before any id is
 * read. Describe uses this to list what a caller can run, and a key is only resolved after it.
 * @param def - The action
 * @param ctx - Who runs it and through what
 */
export function actionRefusal(def: ActionDef, ctx: ActionContext): AppError | undefined {
  const token = isToken(ctx);
  if ((token || ctx.byName) && def.uiOnly) return scopeRefusal();
  if (token && def.tokenBlocked) return scopeRefusal();
  if (def.rest?.raw && !ctx.http) {
    const alternative = def.rawAlternative ? ` ${def.rawAlternative}` : '';
    return new AppError(
      400,
      `Action ${def.name} is only available over REST.${alternative}`,
      'RAW_ACTION',
    );
  }
  if (token && !scopeAllows(ctx.scopes ?? [], def.area, def.kind)) return scopeRefusal();
  return undefined;
}

/**
 * The action with this name, if this caller can run it.
 * @param name - The action's dotted name
 * @param ctx - Who runs it and through what
 * @throws {AppError} 404 UNKNOWN_ACTION, 403 SCOPE, 400 RAW_ACTION
 */
export function assertRunnable(name: string, ctx: ActionContext): ActionDef {
  const def = getAction(name);
  if (!def) throw new AppError(404, `Unknown action: ${name}`, 'UNKNOWN_ACTION');
  const refusal = actionRefusal(def, ctx);
  if (refusal) throw refusal;
  return def;
}

/**
 * The full input schema, refusing unknown fields where the caller names the action: an agent's
 * misspelled field must not read as success. REST keeps dropping them, as it always did.
 * @param def - The action
 * @param ctx - Who runs it
 */
function fullInputSchema(def: ActionDef, ctx: ActionContext): ActionDef['input'] {
  if (!ctx.byName) return def.input;
  const strict = (def.input as { strict?: () => ActionDef['input'] }).strict;
  return strict ? strict.call(def.input) : def.input;
}

/**
 * Run an action. Every adapter comes through here, so REST and MCP share one order of checks:
 * unknown name, uiOnly or tokenBlocked, raw binding, token scope, target, authorize, full input,
 * handler.
 * Authorization comes before the full input so that a refused caller keeps today's 403/404
 * with an invalid body and can't probe the input schema.
 * @param name - The action's dotted name
 * @param rawInput - Its input, not yet validated
 * @param ctx - Who runs it and through what
 * @param bodyError - Set by an adapter whose request body is unusable (missing, an array): the
 * action answers 400 with it once authorize has passed, as a controller validating its body did
 * @returns What the handler returned, unchanged
 * @throws {AppError} 404 UNKNOWN_ACTION, 403 SCOPE, 400 RAW_ACTION, 400 on invalid input, and
 * whatever authorize or the handler throw
 */
export async function executeAction(
  name: string,
  rawInput: unknown,
  ctx: ActionContext,
  bodyError?: string,
): Promise<unknown> {
  const def = getAction(name);
  if (!def) throw new AppError(404, `Unknown action: ${name}`, 'UNKNOWN_ACTION');
  try {
    const result = await runAction(def, rawInput, ctx, bodyError);
    await auditAction(def, rawInput, ctx, { result });
    return result;
  } catch (err) {
    await auditAction(def, rawInput, ctx, { err });
    throw err;
  }
}

/**
 * The checks and the handler of executeAction.
 * @param def - The action
 * @param rawInput - Its input, not yet validated
 * @param ctx - Who runs it and through what
 * @param bodyError - See executeAction
 */
async function runAction(
  def: ActionDef,
  rawInput: unknown,
  ctx: ActionContext,
  bodyError?: string,
): Promise<unknown> {
  const refusal = actionRefusal(def, ctx);
  if (refusal) throw refusal;
  // Ahead of authorize, which reads the ids: Postgres can't compare NUL, so it would be a failed query
  if (!def.checksOwnText && containsNul(rawInput)) {
    throw new AppError(400, 'Text may not contain a NUL character', 'INVALID_TEXT');
  }

  const target = validate(def.target ?? def.input, rawInput);

  // Services read the attribution of their writes from the request context, so it must say
  // who runs this action whichever adapter called
  const requestCtx = {
    userId: ctx.userId,
    apiTokenId: ctx.apiTokenId,
    apiTokenName: ctx.apiTokenName,
    channel: ctx.channel,
  };
  return runWithRequestContext(requestCtx, async () => {
    await def.authorize(ctx, target);
    if (bodyError) throw new AppError(400, bodyError);
    const input = def.target || ctx.byName ? validate(fullInputSchema(def, ctx), rawInput) : target;
    const result: unknown = await def.handler(ctx, input);
    assertOutputShape(def, result);
    return result;
  });
}
