import { get, post, patch, del } from './client';

import type { Organization } from '@/lib/types';

/** Organizations API client for org CRUD and member management. */
export const orgsApi = {
  /** List all organizations the current user belongs to, with their role. */
  list: () => get<(Organization & { role: string })[]>('/orgs'),
  /**
   * Get a single organization by ID.
   * @param orgId
   */
  get: (orgId: string) => get<Organization>(`/orgs/${orgId}`),
  /**
   * Create a new organization.
   * @param data
   * @param data.name
   * @param data.slug
   * @param data.description
   */
  create: (data: { name: string; slug: string; description?: string }) =>
    post<Organization>('/orgs', data),
  /**
   * Update an organization's name or description.
   * @param orgId
   * @param data
   * @param data.name
   * @param data.description
   */
  update: (orgId: string, data: { name?: string; description?: string }) =>
    patch<Organization>(`/orgs/${orgId}`, data),
  /**
   * Delete an organization.
   * @param orgId
   */
  delete: (orgId: string) => del(`/orgs/${orgId}`),
  /**
   * Add a user to an organization with a specific role.
   * @param orgId
   * @param userId
   * @param role
   */
  addMember: (orgId: string, userId: string, role: string) =>
    post(`/orgs/${orgId}/members`, { userId, role }),
  /**
   * Change an organization member's role.
   * @param orgId
   * @param memberId
   * @param role
   */
  updateMemberRole: (orgId: string, memberId: string, role: string) =>
    patch(`/orgs/${orgId}/members/${memberId}`, { role }),
  /**
   * Remove a member from an organization.
   * @param orgId
   * @param memberId
   */
  removeMember: (orgId: string, memberId: string) => del(`/orgs/${orgId}/members/${memberId}`),
};
