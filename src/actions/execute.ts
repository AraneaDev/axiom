import { runWithRequestContext } from '../lib/request-context';
import { AppError } from '../middleware/errorHandler';
import { scopeAllows } from '../middleware/token-scopes';
import { validate } from '../utils/validation/common-validators';

import type { ActionContext, ActionDef } from './define';
import { getAction } from './registry';

/**
 * Whether a token runs this. Each signal counts on its own and a token without scopes holds
 * none, so a context filled in wrongly is refused instead of treated as a session.
 * @param ctx - Who runs the action
 */
function isToken(ctx: ActionContext): boolean {
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

  const token = isToken(ctx);
  if (token && (def.uiOnly || def.tokenBlocked)) throw scopeRefusal();

  if (def.rest?.raw && !ctx.http) {
    throw new AppError(400, `Action ${name} is only available over REST`, 'RAW_ACTION');
  }

  if (token && !scopeAllows(ctx.scopes ?? [], def.area, def.kind)) throw scopeRefusal();

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
    const input = def.target ? validate(def.input, rawInput) : target;
    const result: unknown = await def.handler(ctx, input);
    assertOutputShape(def, result);
    return result;
  });
}
