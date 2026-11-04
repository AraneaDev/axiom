import type { ActionContext } from './define';

/** The old MCP tools' default and cap. */
const AGENT_DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * Which part of a list to answer. Over REST a list without a limit stays whole; where an agent
 * names the action, it gets a page unless it asks otherwise.
 * @param ctx - Who asks
 * @param limit - The limit as text, if given
 * @param offset - The offset as text, if given
 */
export function listWindow(
  ctx: ActionContext,
  limit: string | undefined,
  offset: string | undefined,
): { take?: number; skip: number } {
  const skip = offset ? parseInt(offset, 10) : 0;
  if (limit) return { take: Math.min(Math.max(parseInt(limit, 10), 1), MAX_LIMIT), skip };
  return ctx.byName ? { take: AGENT_DEFAULT_LIMIT, skip } : { skip };
}
