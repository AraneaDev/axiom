import { get, patch, post, del } from './client';

export interface SystemStats {
  totalUsers: number;
  totalOrgs: number;
  totalIssues: number;
  totalWikiPages: number;
  storage: {
    storageBytes: number;
    totalBytes: number;
  };
  databaseSize: string;
}

export interface AdminUser {
  id: string;
  email: string;
  username: string;
  displayName: string;
  avatarUrl?: string;
  isAdmin?: boolean;
  twoFactorEnabled: boolean;
  createdAt: string;
  deactivatedAt?: string | null;
  orgMemberships: {
    role: string;
    org: { id: string; name: string; slug: string };
  }[];
  teamMemberships?: {
    role: string;
    team: { id: string; name: string; slug: string };
  }[];
}

export interface UserListResponse {
  users: AdminUser[];
  total: number;
}

export interface SystemSettings {
  storagePath: string;
  nodeEnv: string;
  port: number;
  corsOrigin: string;
  version: string;
}

export const adminApi = {
  getStats: () => get<SystemStats>('/admin/stats'),

  listUsers: (opts?: { search?: string; limit?: number; offset?: number }) => {
    const params = new URLSearchParams();
    if (opts?.search) params.set('search', opts.search);
    if (opts?.limit) params.set('limit', String(opts.limit));
    if (opts?.offset) params.set('offset', String(opts.offset));
    const qs = params.toString();
    return get<UserListResponse>(`/admin/users${qs ? `?${qs}` : ''}`);
  },

  getUser: (userId: string) => get<AdminUser>(`/admin/users/${userId}`),

  updateUser: (userId: string, data: { role?: string; disabled?: boolean }) =>
    patch<AdminUser>(`/admin/users/${userId}`, data),

  deleteUser: (userId: string) => del<{ deleted: boolean }>(`/admin/users/${userId}`),

  deactivateUser: (userId: string) =>
    post<{ success: boolean }>(`/admin/users/${userId}/deactivate`, {}),
  reactivateUser: (userId: string) =>
    post<{ success: boolean }>(`/admin/users/${userId}/reactivate`, {}),
  resetPassword: (userId: string, newPassword: string) =>
    post<{ success: boolean }>(`/admin/users/${userId}/reset-password`, { newPassword }),

  getSettings: () => get<SystemSettings>('/admin/settings'),
};
