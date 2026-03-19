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

export const webhooksApi = {
  list: (repoId: string) => get<Webhook[]>(`/repos/${repoId}/webhooks`),
  get: (repoId: string, webhookId: string) =>
    get<Webhook>(`/repos/${repoId}/webhooks/${webhookId}`),
  create: (repoId: string, data: { url: string; secret?: string; events: string[] }) =>
    post<Webhook>(`/repos/${repoId}/webhooks`, data),
  update: (
    repoId: string,
    webhookId: string,
    data: { url?: string; secret?: string; events?: string[]; active?: boolean },
  ) => patch<Webhook>(`/repos/${repoId}/webhooks/${webhookId}`, data),
  delete: (repoId: string, webhookId: string) => del(`/repos/${repoId}/webhooks/${webhookId}`),
};
