import { cacheInvalidate } from '../config/redis';

/** Cache TTL for issue list queries (seconds) */
export const ISSUE_LIST_TTL = 30;

/** Cache TTL for board queries (seconds) */
export const BOARD_TTL = 30;

/** Cache TTL for wiki content (seconds) */
export const CONTENT_TTL = 120;

/**
 * Invalidate all cached issue data for a project (list queries + board).
 * @param projectId
 */
export async function invalidateIssueCache(projectId: string): Promise<void> {
  await cacheInvalidate(`issues:${projectId}:*`, `board:${projectId}`);
}
