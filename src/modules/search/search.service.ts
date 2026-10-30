import { parseServicePagination } from '../../utils/pagination';

import { searchIssues, searchWiki, parseStructuredQuery } from './search-queries.service';
import type { SearchParams, SearchResultSection } from './search-queries.service';

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
