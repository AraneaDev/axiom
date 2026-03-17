import { get } from './client';
import type { SearchResult } from '@/lib/types';

export const searchApi = {
  search: (q: string, type: 'issues' | 'wiki' | 'all' = 'all') =>
    get<SearchResult[]>(`/search?q=${encodeURIComponent(q)}&type=${type}`),
};
