import { get, post, patch, del } from './client';

export interface SavedFilter {
  id: string;
  userId: string;
  projectId: string | null;
  name: string;
  query: Record<string, string>;
  visibility?: 'PRIVATE' | 'TEAM' | 'ORG';
  /** Whether the current user may change or delete it */
  canEdit?: boolean;
  createdAt: string;
}

/** Saved filters API client for persisting and managing reusable issue filter presets. */
export const savedFiltersApi = {
  /**
   * List saved filters, optionally scoped to a project.
   * @param projectId
   */
  list: (projectId?: string) =>
    get<SavedFilter[]>(`/saved-filters${projectId ? `?projectId=${projectId}` : ''}`),
  /**
   * Create a new saved filter with a name and query parameters.
   * @param data
   * @param data.name
   * @param data.query
   * @param data.projectId
   */
  create: (data: { name: string; query: Record<string, string>; projectId?: string }) =>
    post<SavedFilter>('/saved-filters', data),
  /**
   * Save a query written in the query language, private or shared with a team or org.
   * @param data
   * @param data.name
   * @param data.text
   * @param data.visibility
   * @param data.teamId
   * @param data.orgId
   */
  createQuery: (data: {
    name: string;
    text: string;
    visibility?: 'PRIVATE' | 'TEAM' | 'ORG';
    teamId?: string;
    orgId?: string;
  }) => post<SavedFilter>('/saved-filters', data),
  /**
   * Update a saved filter's name or query.
   * @param filterId
   * @param data
   * @param data.name
   * @param data.query
   */
  update: (filterId: string, data: { name?: string; query?: Record<string, string> }) =>
    patch<SavedFilter>(`/saved-filters/${filterId}`, data),
  /**
   * Delete a saved filter by ID.
   * @param filterId
   */
  delete: (filterId: string) => del(`/saved-filters/${filterId}`),
};
