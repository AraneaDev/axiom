import type { Organization, UserKind } from '@/lib/types';

import { get, post, patch, del } from './client';

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
   * The people of an organization with their roles. Bots stay out: this feeds pickers.
   * @param orgId
   */
  listMembers: (orgId: string) => get<OrgMember[]>(`/orgs/${orgId}/members`),
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
  createInvitation: (orgId: string, data: { email: string; role?: string; teamId?: string }) =>
    post<Invitation>(`/orgs/${orgId}/invitations`, data),
  listInvitations: (orgId: string, teamId?: string) =>
    get<Invitation[]>(`/orgs/${orgId}/invitations${teamId ? `?teamId=${teamId}` : ''}`),
  revokeInvitation: (orgId: string, invitationId: string) =>
    del(`/orgs/${orgId}/invitations/${invitationId}`),
  acceptInvitation: (token: string) =>
    post<{
      org: { id: string; name: string; slug: string };
      team: { id: string; name: string; slug: string } | null;
    }>(`/invitations/${token}/accept`, {}),
};

/** A member of an org, as the member list gives it */
export interface OrgMember {
  userId: string;
  role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER' | 'GUEST';
  user: {
    id: string;
    username: string;
    displayName: string;
    kind?: UserKind;
    /** Set for someone deactivated: they can't own a bot */
    deactivatedAt?: string | null;
  };
}

export interface Invitation {
  id: string;
  email: string;
  orgId: string;
  teamId: string | null;
  role: string;
  status: string;
  token: string;
  expiresAt: string;
  createdAt: string;
  inviter: { id: string; displayName: string; username: string };
  org: { id: string; name: string; slug: string };
  team: { id: string; name: string; slug: string } | null;
}
