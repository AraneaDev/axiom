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

export interface NotificationPreference {
  eventType: string;
  inApp: boolean;
  email: boolean;
}

interface PreferencesResult {
  preferences: NotificationPreference[];
}

interface PreferenceUpdateResult {
  preference: NotificationPreference;
}

/** Notifications API client for listing, reading, and managing user notifications. */
export const notificationsApi = {
  /**
   * List notifications with optional filters for unread status and pagination.
   * @param opts
   * @param opts.unreadOnly
   * @param opts.limit
   * @param opts.offset
   */
  list: (opts?: { unreadOnly?: boolean; limit?: number; offset?: number }) => {
    const params = new URLSearchParams();
    if (opts?.unreadOnly) params.set('unreadOnly', 'true');
    if (opts?.limit) params.set('limit', String(opts.limit));
    if (opts?.offset) params.set('offset', String(opts.offset));
    const qs = params.toString();
    return get<ListResult>(`/notifications${qs ? `?${qs}` : ''}`);
  },
  /**
   * Mark a single notification as read.
   * @param id
   */
  markRead: (id: string) => patch<{ success: boolean }>(`/notifications/${id}/read`, {}),
  /** Mark all notifications as read. */
  markAllRead: () => post<{ success: boolean }>('/notifications/read-all', {}),
  /** Get the count of unread notifications. */
  getUnreadCount: () => get<{ count: number }>('/notifications/unread-count'),
  /** Get notification preferences for the current user. */
  getPreferences: () => get<PreferencesResult>('/notifications/preferences'),
  /**
   * Update a single notification preference.
   * @param eventType
   * @param settings
   * @param settings.inApp
   * @param settings.email
   */
  updatePreference: (eventType: string, settings: { inApp?: boolean; email?: boolean }) =>
    patch<PreferenceUpdateResult>('/notifications/preferences', { eventType, ...settings }),
};
