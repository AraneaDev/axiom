import type { UserKind } from '@/lib/types';

import { get } from './client';

export interface AuditLogEntry {
  id: string;
  orgId: string;
  userId: string | null;
  /** Null for a row without a user, and for a user who has since been removed */
  userName: string | null;
  /** The kind of that user, null like userName */
  userKind: UserKind | null;
  action: string;
  resource: string;
  details: Record<string, unknown> | null;
  /** Name of the API token that made the change, null for a browser session */
  via: string | null;
  createdAt: string;
}

export interface AuditLogListResponse {
  logs: AuditLogEntry[];
  total: number;
}

export interface AuditLogFilters {
  userId?: string;
  resourceType?: string;
  action?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
}

export const auditApi = {
  list: (filters?: AuditLogFilters) => {
    const params = new URLSearchParams();
    if (filters?.userId) params.set('userId', filters.userId);
    if (filters?.resourceType) params.set('resourceType', filters.resourceType);
    if (filters?.action) params.set('action', filters.action);
    if (filters?.startDate) params.set('startDate', filters.startDate);
    if (filters?.endDate) params.set('endDate', filters.endDate);
    if (filters?.limit) params.set('limit', String(filters.limit));
    if (filters?.offset) params.set('offset', String(filters.offset));
    const q = params.toString();
    return get<AuditLogListResponse>(`/admin/audit-logs${q ? `?${q}` : ''}`);
  },

  get: (id: string) => get<AuditLogEntry>(`/admin/audit-logs/${id}`),
};
