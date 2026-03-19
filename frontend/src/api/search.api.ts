import { get, post, del } from './client';

import type { SearchResult, CodeSearchResult, SavedSearch } from '@/lib/types';

export type SearchType = 'issues' | 'wiki' | 'repos' | 'code' | 'all';

/** Search API client for full-text search across issues, wiki, repos, and code. */
export const searchApi = {
  /**
   * Search across all entity types or a specific type.
   * @param q
   * @param type
   */
  search: (q: string, type: SearchType = 'all') =>
    get<SearchResult[]>(`/search?q=${encodeURIComponent(q)}&type=${type}`),

  /**
   * Search code content across repositories, optionally filtered by repo IDs.
   * @param q
   * @param repoIds
   */
  searchCode: (q: string, repoIds?: string) => {
    const params = new URLSearchParams({ q });
    if (repoIds) params.set('repoIds', repoIds);
    return get<CodeSearchResult>(`/search/code?${params.toString()}`);
  },

  /** Get the current user's saved searches. */
  getSavedSearches: () => get<SavedSearch[]>('/search/saved'),

  /**
   * Save a search query for quick access later.
   * @param name
   * @param query
   */
  createSavedSearch: (name: string, query: SavedSearch['query']) =>
    post<SavedSearch>('/search/saved', { name, query }),

  /**
   * Delete a saved search by ID.
   * @param id
   */
  deleteSavedSearch: (id: string) => del(`/search/saved/${id}`),
};
