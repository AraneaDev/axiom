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

export const notificationsApi = {
  list: (opts?: { unreadOnly?: boolean; limit?: number; offset?: number }) => {
    const params = new URLSearchParams();
    if (opts?.unreadOnly) params.set('unreadOnly', 'true');
    if (opts?.limit) params.set('limit', String(opts.limit));
    if (opts?.offset) params.set('offset', String(opts.offset));
    const qs = params.toString();
    return get<ListResult>(`/notifications${qs ? `?${qs}` : ''}`);
  },
  markRead: (id: string) => patch<{ success: boolean }>(`/notifications/${id}/read`, {}),
  markAllRead: () => post<{ success: boolean }>('/notifications/read-all', {}),
  getUnreadCount: () => get<{ count: number }>('/notifications/unread-count'),
};
