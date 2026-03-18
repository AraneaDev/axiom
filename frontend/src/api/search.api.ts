import { get, post, del } from './client';

import type { SearchResult, CodeSearchResult, SavedSearch } from '@/lib/types';

export type SearchType = 'issues' | 'wiki' | 'repos' | 'code' | 'all';

export const searchApi = {
  search: (q: string, type: SearchType = 'all') =>
    get<SearchResult[]>(`/search?q=${encodeURIComponent(q)}&type=${type}`),

  searchCode: (q: string, repoIds?: string) => {
    const params = new URLSearchParams({ q });
    if (repoIds) params.set('repoIds', repoIds);
    return get<CodeSearchResult>(`/search/code?${params.toString()}`);
  },

  getSavedSearches: () => get<SavedSearch[]>('/search/saved'),

  createSavedSearch: (name: string, query: SavedSearch['query']) =>
    post<SavedSearch>('/search/saved', { name, query }),

  deleteSavedSearch: (id: string) => del(`/search/saved/${id}`),
};
