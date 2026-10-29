import type { SearchResult, SavedSearch } from '@/lib/types';

import { get, post, del } from './client';

export type SearchType = 'issues' | 'wiki' | 'all';

export interface SearchFilters {
  spaceId?: string;
  label?: string;
  since?: string;
  until?: string;
}

/** Search API client for full-text search across issues and wiki pages. */
export const searchApi = {
  /**
   * Search across all entity types or a specific type with optional wiki filters.
   * @param q
   * @param type
   * @param filters
   */
  search: (q: string, type: SearchType = 'all', filters?: SearchFilters) => {
    const params = new URLSearchParams({ q, type });
    if (filters?.spaceId) params.set('spaceId', filters.spaceId);
    if (filters?.label) params.set('label', filters.label);
    if (filters?.since) params.set('since', filters.since);
    if (filters?.until) params.set('until', filters.until);
    return get<SearchResult[]>(`/search?${params.toString()}`);
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

  /** Get all wiki spaces accessible to the current user (for search filter dropdown). */
  getAccessibleSpaces: () =>
    get<Array<{ id: string; name: string; slug: string }>>('/search/spaces'),
};
