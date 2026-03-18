import { get, post, patch, del } from './client';

import type { Team } from '@/lib/types';

export const teamsApi = {
  listByOrg: (orgId: string) => get<Team[]>(`/teams/org/${orgId}`),
  get: (teamId: string) => get<Team>(`/teams/${teamId}`),
  create: (orgId: string, data: { name: string; slug: string; description?: string }) =>
    post<Team>(`/teams/org/${orgId}`, data),
  update: (teamId: string, data: { name?: string; description?: string }) =>
    patch<Team>(`/teams/${teamId}`, data),
  delete: (teamId: string) => del(`/teams/${teamId}`),
  addMember: (teamId: string, userId: string, role: string) =>
    post(`/teams/${teamId}/members`, { userId, role }),
  updateMemberRole: (teamId: string, memberId: string, role: string) =>
    patch(`/teams/${teamId}/members/${memberId}`, { role }),
  removeMember: (teamId: string, memberId: string) => del(`/teams/${teamId}/members/${memberId}`),
};
