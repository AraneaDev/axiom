import { get, post, patch, del } from './client';

export interface Webhook {
  id: string;
  repoId: string;
  url: string;
  secret?: string;
  events: string[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export const WEBHOOK_EVENTS = [
  { value: 'push', label: 'Push' },
  { value: 'pr:created', label: 'Pull request created' },
  { value: 'pr:merged', label: 'Pull request merged' },
  { value: 'pr:closed', label: 'Pull request closed' },
  { value: 'issues', label: 'Issues' },
  { value: 'release', label: 'Releases' },
  { value: '*', label: 'All events' },
] as const;

/** Webhooks API client for managing repository webhook subscriptions. */
export const webhooksApi = {
  /**
   * List all webhooks for a repository.
   * @param repoId
   */
  list: (repoId: string) => get<Webhook[]>(`/repos/${repoId}/webhooks`),
  /**
   * Get a single webhook by ID.
   * @param repoId
   * @param webhookId
   */
  get: (repoId: string, webhookId: string) =>
    get<Webhook>(`/repos/${repoId}/webhooks/${webhookId}`),
  /**
   * Create a new webhook with a URL, optional secret, and event subscriptions.
   * @param repoId
   * @param data
   * @param data.url
   * @param data.secret
   * @param data.events
   */
  create: (repoId: string, data: { url: string; secret?: string; events: string[] }) =>
    post<Webhook>(`/repos/${repoId}/webhooks`, data),
  /**
   * Update a webhook's URL, secret, events, or active status.
   * @param repoId
   * @param webhookId
   * @param data
   * @param data.url
   * @param data.secret
   * @param data.events
   * @param data.active
   */
  update: (
    repoId: string,
    webhookId: string,
    data: { url?: string; secret?: string; events?: string[]; active?: boolean },
  ) => patch<Webhook>(`/repos/${repoId}/webhooks/${webhookId}`, data),
  /**
   * Delete a webhook by ID.
   * @param repoId
   * @param webhookId
   */
  delete: (repoId: string, webhookId: string) => del(`/repos/${repoId}/webhooks/${webhookId}`),
};
