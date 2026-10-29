import { prisma } from '../../config/database';
import { parseServicePagination } from '../../utils/pagination';

import { searchIssues, searchWiki, parseStructuredQuery } from './search-queries.service';
import type { SearchParams, SearchResultSection } from './search-queries.service';

// ─── Helpers ────────────────────────────────────────────────

/**
 * Get all organization IDs a user belongs to.
 * @param userId - The user ID
 * @returns Array of org IDs the user is a member of
 */
export async function getUserOrgIds(userId: string): Promise<string[]> {
  const memberships = await prisma.orgMembership.findMany({
    where: { userId },
    select: { orgId: true },
  });
  return memberships.map((m: { orgId: string }) => m.orgId);
}

// ─── Main Search ────────────────────────────────────────────

/**
 * Perform a cross-resource search across issues, and wiki pages.
 * @param params - Search parameters including query, type filter, team/project scope, and pagination
 * @returns Array of result sections by resource type with items and totals
 */
export async function search(params: SearchParams) {
  const { take, skip } = parseServicePagination(params);
  params = { ...params, limit: take, offset: skip };
  const { freeText, filters } = parseStructuredQuery(params.q);
  const results: SearchResultSection[] = [];

  if (params.type === 'issues' || params.type === 'all') {
    const issueResults = await searchIssues(freeText, filters, params, params.q);
    results.push(issueResults);
  }

  if (params.type === 'wiki' || params.type === 'all') {
    const wikiResults = await searchWiki(freeText, filters, params);
    results.push(wikiResults);
  }

  return results;
}

// ─── Re-exports ─────────────────────────────────────────────

export {
  getAccessibleSpaces,
  createSavedSearch,
  getSavedSearches,
  deleteSavedSearch,
} from './search-filters.service';
