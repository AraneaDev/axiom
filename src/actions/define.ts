import type { Request, Response } from 'express';
import type { z } from 'zod';

import type { ScopeArea } from '../middleware/token-scopes';

/** Who runs an action and through what. `scopes` is set for tokens and absent for sessions. */
export interface ActionContext {
  userId: string;
  apiTokenId?: string;
  apiTokenName?: string;
  scopes?: readonly string[];
  channel: 'ui' | 'rest-token' | 'mcp';
  /**
   * The raw request and response. The REST adapter sets this for `raw` bindings only. A handler
   * reads ids from its `input`, never from `http.req.query`, `http.req.params` or `http.req.body`:
   * authorize saw the merged input, in which a param overrides a field of the same name, and a
   * multipart body is only parsed after authorize ran. So these can differ, and the handler would
   * act on what was not authorized.
   */
  http?: { req: Request; res: Response };
}

/** Where the REST adapter mounts an action. */
export interface RestBinding {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  status?: number;
  /** The handler answers through `ctx.http` itself (uploads, downloads, exports). */
  raw?: boolean;
  /** The route takes no body (a toggle): whatever the request carries is ignored. */
  emptyBody?: boolean;
}

/** What authorize receives: the target when the action declares one, else the full input. */
type AuthorizeInput<I extends z.ZodType, T> = T extends z.ZodType ? z.infer<T> : z.infer<I>;

// `any` by default so that one list can hold actions with different schemas
/* eslint-disable @typescript-eslint/no-explicit-any */
export interface ActionDef<
  I extends z.ZodType = any,
  O extends z.ZodType = any,
  T extends z.ZodType | undefined = any,
> {
  /** Dotted, e.g. 'issue.update' */
  name: string;
  area: ScopeArea;
  kind: 'read' | 'write';
  /** One line, shown by describe */
  summary: string;
  input: I;
  output: O;
  /**
   * Only the ids authorize needs. Authorization runs before the full input is validated, so a
   * refused caller gets 403/404 whatever the body holds. Actions with a body must declare this.
   * Without it, authorize gets the full input, parsed first.
   * Declare `input` as `target.extend({...})`, so authorize and the handler parse ids alike.
   */
  target?: T;
  /** Used by plan 3 */
  destructive?: boolean;
  /** Login and the like: never open to a token or MCP, whatever its scopes */
  uiOnly?: boolean;
  /**
   * A normal action for a browser session, refused to every token until plan 3 adds approval.
   * Answers like uiOnly; use this for what the UI still calls as an ordinary action.
   */
  tokenBlocked?: boolean;
  rest?: RestBinding;
  /** Throws an AppError (403/404) to refuse. */
  authorize(ctx: ActionContext, target: AuthorizeInput<I, T>): Promise<void>;
  handler(ctx: ActionContext, input: z.infer<I>): Promise<z.infer<O>>;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Declare an action. Returns it unchanged; this exists so that TypeScript infers the handler's
 * input and output from the schemas, and authorize's input from the target or the full input.
 * @param def - The action
 */
export function defineAction<I extends z.ZodType, O extends z.ZodType>(
  def: ActionDef<I, O, undefined> & { target?: undefined },
): ActionDef<I, O, undefined>;
export function defineAction<I extends z.ZodType, O extends z.ZodType, T extends z.ZodType>(
  def: ActionDef<I, O, T> & { target: T },
): ActionDef<I, O, T>;
export function defineAction(def: ActionDef): ActionDef {
  return def;
}
