import { get, patch, post } from './client';

export interface Notification {
  id: string;
  userId: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  createdAt: string;
}

interface ListResult {
  notifications: Notification[];
  total: number;
}

/**
 *
 * @param opts
 * @param opts.unreadOnly
 * @param opts.limit
 * @param opts.offset
 */
export function list(opts?: { unreadOnly?: boolean; limit?: number; offset?: number }) {
  const params = new URLSearchParams();
  if (opts?.unreadOnly) params.set('unreadOnly', 'true');
  if (opts?.limit) params.set('limit', String(opts.limit));
  if (opts?.offset) params.set('offset', String(opts.offset));
  const qs = params.toString();
  return get<ListResult>(`/notifications${qs ? `?${qs}` : ''}`);
}

/**
 *
 * @param id
 */
export function markRead(id: string) {
  return patch<{ success: boolean }>(`/notifications/${id}/read`, {});
}

/**
 *
 */
export function markAllRead() {
  return post<{ success: boolean }>('/notifications/read-all', {});
}

/**
 *
 */
export function getUnreadCount() {
  return get<{ count: number }>('/notifications/unread-count');
}
