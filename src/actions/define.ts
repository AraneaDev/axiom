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
  /** The raw request and response. The REST adapter sets this for `raw` bindings only. */
  http?: { req: Request; res: Response };
}

/** Where the REST adapter mounts an action. */
export interface RestBinding {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  status?: number;
  /** The handler answers through `ctx.http` itself (uploads, downloads, exports). */
  raw?: boolean;
}

// `any` by default so that one list can hold actions with different schemas
/* eslint-disable @typescript-eslint/no-explicit-any */
export interface ActionDef<I extends z.ZodType = any, O extends z.ZodType = any> {
  /** Dotted, e.g. 'issue.update' */
  name: string;
  area: ScopeArea;
  kind: 'read' | 'write';
  /** One line, shown by describe */
  summary: string;
  input: I;
  output: O;
  /** Used by plan 3 */
  destructive?: boolean;
  /** Login and the like: never open to a token or MCP, whatever its scopes */
  uiOnly?: boolean;
  rest?: RestBinding;
  /** Throws an AppError (403/404) to refuse. */
  authorize(ctx: ActionContext, input: z.infer<I>): Promise<void>;
  handler(ctx: ActionContext, input: z.infer<I>): Promise<z.infer<O>>;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Declare an action. Returns it unchanged; this exists so that TypeScript infers the handler's
 * input and output from the schemas.
 * @param def - The action
 */
export function defineAction<I extends z.ZodType, O extends z.ZodType>(
  def: ActionDef<I, O>,
): ActionDef<I, O> {
  return def;
}
