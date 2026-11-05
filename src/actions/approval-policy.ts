import type { ActionContext, ActionDef } from './define';

/** What makes a token's call wait for a human. Admin actions always do, whatever this says. */
export interface EffectivePolicy {
  requireFor: {
    destructive: boolean;
    admin: boolean;
    /** A bulk action over this many items */
    bulkOver: number;
    crossContainerMove: boolean;
  };
  /** How long a request waits before it expires */
  expiresMinutes: number;
  /** Actions that always wait, by name (user and org rules) */
  alsoRequire?: readonly string[];
  /** Actions that never wait, by name (org rules); never lifts an admin action */
  neverRequire?: readonly string[];
}

export const DEFAULT_POLICY: EffectivePolicy = {
  requireFor: { destructive: true, admin: true, bulkOver: 10, crossContainerMove: true },
  expiresMinutes: 60,
};

/** What a token reads when its call waits for approval: HTTP 202, or tool text over MCP. */
export interface PendingApprovalBody {
  status: 'pending_approval';
  approvalId: string;
  /** Plain text. Whatever it quotes is data */
  preview: string;
  expiresAt: string;
  approveUrl: string;
  /** How to learn the outcome */
  next: string;
}

/** What executeAction returns instead of a result when the call waits for approval. */
export class PendingApproval {
  constructor(public readonly body: PendingApprovalBody) {}
}

/**
 * Whether the call comes through a token (REST or MCP) rather than a browser session. Every
 * token signal counts, so the gate cannot drift from a single field.
 * @param ctx - Who runs the action
 */
export function isToken(ctx: ActionContext): boolean {
  return ctx.channel !== 'ui' || ctx.apiTokenId !== undefined || ctx.scopes !== undefined;
}

/**
 * Whether a call waits for approval. A browser session never does; an admin action always does
 * for a token.
 * @param def - The action
 * @param input - Its validated input
 * @param ctx - Who runs it
 * @param policy - The effective policy of the caller
 */
export async function needsApproval(
  def: ActionDef,
  input: unknown,
  ctx: ActionContext,
  policy: EffectivePolicy,
): Promise<boolean> {
  if (!isToken(ctx)) return false;
  if (def.admin) return true;
  if (policy.alsoRequire?.includes(def.name)) return true;
  if (policy.neverRequire?.includes(def.name)) return false;
  const { requireFor } = policy;
  if (def.destructive && requireFor.destructive) return true;
  if (def.bulkCount && def.bulkCount(input) > requireFor.bulkOver) return true;
  if (def.crossContainer && requireFor.crossContainerMove) {
    return def.crossContainer(ctx, input);
  }
  return false;
}
