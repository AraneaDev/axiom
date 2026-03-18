import { get, post, patch, del } from './client';

export interface SavedFilter {
  id: string;
  userId: string;
  projectId: string | null;
  name: string;
  query: Record<string, string>;
  createdAt: string;
}

export const savedFiltersApi = {
  list: (projectId?: string) =>
    get<SavedFilter[]>(`/saved-filters${projectId ? `?projectId=${projectId}` : ''}`),
  create: (data: { name: string; query: Record<string, string>; projectId?: string }) =>
    post<SavedFilter>('/saved-filters', data),
  update: (filterId: string, data: { name?: string; query?: Record<string, string> }) =>
    patch<SavedFilter>(`/saved-filters/${filterId}`, data),
  delete: (filterId: string) => del(`/saved-filters/${filterId}`),
};
