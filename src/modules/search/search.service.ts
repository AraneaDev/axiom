import { parseServicePagination } from '../../utils/pagination';

import {
  pagesByExactTitle,
  searchIssues,
  searchWiki,
  parseStructuredQuery,
} from './search-queries.service';
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

// ─── Search for agents ──────────────────────────────────────

/**
 * The same search for an agent: only the sections asked for and allowed, each result small enough
 * to scan and named by a key that item.read takes. Pages titled exactly the query come first.
 * @param params - The search
 * @param params.q - The query
 * @param params.limit - The most results per section
 * @param params.userId - Who searches: results are what this user could open
 * @param params.issues - Whether to search issues
 * @param params.wiki - Whether to search the wiki
 * @returns Sections as the REST search has them, with smaller items
 */
export async function searchForAgent(params: {
  q: string;
  limit: number;
  userId: string;
  issues: boolean;
  wiki: boolean;
}) {
  const { q, limit, userId } = params;
  const { freeText, filters } = parseStructuredQuery(q);
  const query: SearchParams = { q, type: 'all', limit, offset: 0, userId };
  const sections: Array<{ type: string; total: number; items: Array<Record<string, unknown>> }> =
    [];

  if (params.issues) {
    const found = await searchIssues(freeText, filters, query, q);
    sections.push({
      type: 'issues',
      total: found.total,
      items: found.items.map((issue) => ({
        key: issue.key,
        fullKey: `${issue.project.team.org.slug}/${issue.project.team.slug}/${issue.key}`,
        url: issue.url,
        title: issue.title,
        type: issue.type,
        priority: issue.priority,
        status: issue.status,
        assignee: issue.assignee?.displayName ?? null,
        projectName: issue.projectName,
        updatedAt: issue.updatedAt,
      })),
    });
  }

  if (params.wiki) {
    const found = await searchWiki(freeText, filters, query);
    const exact = await pagesByExactTitle(q.trim(), userId, limit);
    const exactIds = new Set(exact.map((page) => page.id));
    const others = found.items.filter((page) => !exactIds.has(page.id));
    const missed = exact.length - (found.items.length - others.length);
    sections.push({
      type: 'wiki',
      total: found.total + missed,
      items: [...exact, ...others].slice(0, limit).map((page) => ({
        key: `${page.space.team.org.slug}/${page.space.team.slug}/${page.space.slug}/${page.slug}`,
        url: page.url,
        title: page.title,
        slug: page.slug,
        spaceId: page.spaceId,
        spaceName: page.spaceName,
        labels: page.labels,
        snippet: page.snippet,
        updatedAt: page.updatedAt,
      })),
    });
  }

  return sections;
}

// ─── Re-exports ─────────────────────────────────────────────

export {
  getAccessibleSpaces,
  createSavedSearch,
  getSavedSearches,
  deleteSavedSearch,
} from './search-filters.service';
