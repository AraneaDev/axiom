import { get, post, patch, del } from './client';
import type { Organization } from '@/lib/types';

export const orgsApi = {
  list: () => get<(Organization & { role: string })[]>('/orgs'),
  get: (orgId: string) => get<Organization>(`/orgs/${orgId}`),
  create: (data: { name: string; slug: string; description?: string }) =>
    post<Organization>('/orgs', data),
  update: (orgId: string, data: { name?: string; description?: string }) =>
    patch<Organization>(`/orgs/${orgId}`, data),
  delete: (orgId: string) => del(`/orgs/${orgId}`),
  addMember: (orgId: string, userId: string, role: string) =>
    post(`/orgs/${orgId}/members`, { userId, role }),
  updateMemberRole: (orgId: string, memberId: string, role: string) =>
    patch(`/orgs/${orgId}/members/${memberId}`, { role }),
  removeMember: (orgId: string, memberId: string) => del(`/orgs/${orgId}/members/${memberId}`),
};
