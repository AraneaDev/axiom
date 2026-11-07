import type { Request, RequestHandler, Response } from 'express';
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
  /**
   * Set by the adapters where the caller names the action (/api/act and MCP) rather than a route
   * deciding it. These audit per action, parse the input strictly, and leave uiOnly actions to
   * their own routes and limiters.
   */
  byName?: { ipAddress?: string };
  /** Where a REST caller came from, for an audit row written here rather than per request */
  ipAddress?: string;
  /**
   * Set on the run of an approved request, so its audit row names the request. Says nothing to the
   * gate: only the approval service can let a run through.
   */
  approvalRunId?: string;
}

/**
 * The context of a public action: nobody signed in, so there is no user to read. Typing it so
 * keeps a public action from acting for someone it never authenticated (ruling B9).
 */
export type PublicActionContext = Omit<ActionContext, 'userId'> & { userId?: undefined };

/** Where the REST adapter mounts an action. */
export interface RestBinding {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  status?: number;
  /** The handler answers through `ctx.http` itself (uploads, downloads, exports). */
  raw?: boolean;
  /** The route takes no body (a toggle): whatever the request carries is ignored. */
  emptyBody?: boolean;
  /** The body may be left out altogether; one that is sent is read and validated as usual. */
  optionalBody?: boolean;
  /**
   * No authentication: anyone may call it, and a credential that comes along is not read. The
   * context holds no user (`ctx.userId` is undefined at runtime): declare the action with
   * `definePublicAction`, whose context types it so.
   * For what is open today (public forms, health), nothing else.
   */
  public?: boolean;
  /** A limiter for this route alone, ahead of authentication, so a refused caller costs little. */
  rateLimit?: RequestHandler;
  /**
   * Handlers after authentication (before authorize) for what the old route had on its own, such
   * as a CSRF check or require2fa. Use only where the old route had them.
   */
  middleware?: RequestHandler[];
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
  /** Deletes data or changes who may reach it: a token's call waits for approval by default */
  destructive?: boolean;
  /**
   * Destructive for some inputs only (a rename that changes what a workflow means). Counts as
   * `destructive` for those calls, so an org's rules can relax it, unlike `permissionChange`.
   */
  destructiveWhen?(input: z.infer<I>): boolean;
  /**
   * The orgs this call touches, read from the database rather than from what the agent sent. For
   * an action whose input names no project, team, space, issue, page or sprint: a dashboard, a
   * saved query, an attachment target. An org's rules bind the call through it.
   */
  orgIds?(ctx: ActionContext, input: z.infer<I>): Promise<string[]>;
  /**
   * Whether this call changes who may reach something (sharing). Such a call always waits for
   * approval when a token makes it, whatever an org's rules say, as it can take a record out of
   * the sight of the rules that bind it.
   */
  permissionChange?(input: z.infer<I>): boolean;
  /**
   * Always waits for approval when a token makes the call, whatever an org's or a user's rules
   * say (merging, closing or deleting on a code host). Unlike `destructive` no policy lifts it.
   */
  alwaysApprove?: boolean;
  /** States on purpose that the action belongs to no org (a private dashboard or query) */
  noOrg?: boolean;
  /**
   * For what is the user's own state (profile, notifications, the dashboard): a token that holds
   * read or write on any of these areas runs it, whatever its kind, in place of the scope of
   * `area` and `kind`. These two still name the action in the docs and the audit log.
   */
  openToReadOf?: readonly ScopeArea[];
  /** Always waits for approval when a token calls it, whatever the policy says */
  admin?: boolean;
  /**
   * What the approver reads, built from database values by the server and shown as plain text.
   * Whatever it quotes (a title) is data.
   */
  preview?(ctx: ActionContext, input: z.infer<I>): Promise<string>;
  /** How many items a bulk action touches; over the policy's `bulkOver` it waits for approval */
  bulkCount?(input: z.infer<I>): number;
  /**
   * Whether this call moves something into another project or space. The database decides, not
   * the input. Only moves with a destination elsewhere declare it.
   */
  crossContainer?(ctx: ActionContext, input: z.infer<I>): Promise<boolean>;
  /**
   * What an approved run may store and tell the agent that waits. A secret in the result stays in
   * the approver's own answer. Without this, the whole result is stored.
   */
  redactResult?(result: z.infer<O>): unknown;
  /** Login and the like: never open to a token or MCP, whatever its scopes */
  uiOnly?: boolean;
  /**
   * A normal action for a browser session, refused to every token until plan 3 adds approval.
   * Answers like uiOnly; use this for what the UI still calls as an ordinary action.
   */
  tokenBlocked?: boolean;
  rest?: RestBinding;
  /**
   * What an audit row names beyond the id fields of the schemas and the id of the result: dotted
   * paths, for targets in other fields, lists, and what the action created.
   */
  auditFields?: { input?: string[]; result?: string[] };
  /** Reads its text fields itself and answers per item, so NUL isn't refused for the whole call. */
  checksOwnText?: boolean;
  /** For a `raw` binding: what to use instead where it can't run, told in the 400 it answers. */
  rawAlternative?: string;
  /** Throws an AppError (403/404) to refuse. */
  authorize(ctx: ActionContext, target: AuthorizeInput<I, T>): Promise<void>;
  handler(ctx: ActionContext, input: z.infer<I>): Promise<z.infer<O>>;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Declare an action. A public one (no sign-in) is declared with `definePublicAction` instead.
 * Returns it unchanged; this exists so that TypeScript infers the handler's
 * input and output from the schemas, and authorize's input from the target or the full input.
 * @param def - The action
 */
export function defineAction<I extends z.ZodType, O extends z.ZodType>(
  def: ActionDef<I, O, undefined> & { target?: undefined; rest?: { public?: false } },
): ActionDef<I, O, undefined>;
export function defineAction<I extends z.ZodType, O extends z.ZodType, T extends z.ZodType>(
  def: ActionDef<I, O, T> & { target: T; rest?: { public?: false } },
): ActionDef<I, O, T>;
export function defineAction(def: ActionDef): ActionDef {
  return def;
}

/** The parts of an action that run with a context, for a public one. */
type ContextFree = 'authorize' | 'handler' | 'rest' | 'orgIds' | 'preview' | 'crossContainer';

/* eslint-disable @typescript-eslint/no-explicit-any */
type PublicDef<I extends z.ZodType, O extends z.ZodType, T extends z.ZodType | undefined> = Omit<
  ActionDef<I, O, T>,
  ContextFree
> & {
  rest: RestBinding & { public: true };
  authorize(ctx: PublicActionContext, target: AuthorizeInput<I, T>): Promise<void>;
  handler(ctx: PublicActionContext, input: z.infer<I>): Promise<z.infer<O>>;
};

/**
 * Declare an action that anyone may call, with no user: its `authorize` and `handler` get a
 * context whose `userId` is `undefined`, so reading it does not compile. Needs a `rest` binding
 * with `public: true`, which the REST adapter runs with no authentication.
 * @param def - The action
 */
export function definePublicAction<I extends z.ZodType, O extends z.ZodType>(
  def: PublicDef<I, O, undefined> & { target?: undefined },
): ActionDef<I, O, undefined>;
export function definePublicAction<I extends z.ZodType, O extends z.ZodType, T extends z.ZodType>(
  def: PublicDef<I, O, T> & { target: T },
): ActionDef<I, O, T>;
export function definePublicAction(def: PublicDef<any, any, any>): ActionDef {
  // The context is the same object; only what the handler may read of it is narrower
  return def as unknown as ActionDef;
}
/* eslint-enable @typescript-eslint/no-explicit-any */
