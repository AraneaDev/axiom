import { get, post, patch, del } from './client';

import type { Team } from '@/lib/types';

/** Teams API client for team CRUD and member management within an organization. */
export const teamsApi = {
  /**
   * List all teams in an organization.
   * @param orgId
   */
  listByOrg: async (orgId: string) => {
    const res = await get<{ data: Team[] }>(`/teams/org/${orgId}`);
    return res.data;
  },
  /**
   * Get a single team by ID.
   * @param teamId
   */
  get: (teamId: string) => get<Team>(`/teams/${teamId}`),
  /**
   * Create a new team in an organization.
   * @param orgId
   * @param data
   * @param data.name
   * @param data.slug
   * @param data.description
   */
  create: (orgId: string, data: { name: string; slug: string; description?: string }) =>
    post<Team>(`/teams/org/${orgId}`, data),
  /**
   * Update a team's name or description.
   * @param teamId
   * @param data
   * @param data.name
   * @param data.description
   */
  update: (teamId: string, data: { name?: string; description?: string }) =>
    patch<Team>(`/teams/${teamId}`, data),
  /**
   * Delete a team.
   * @param teamId
   */
  delete: (teamId: string) => del(`/teams/${teamId}`),
  /**
   * Add a user to a team with a specific role.
   * @param teamId
   * @param userId
   * @param role
   */
  addMember: (teamId: string, userId: string, role: string) =>
    post(`/teams/${teamId}/members`, { userId, role }),
  /**
   * Change a team member's role.
   * @param teamId
   * @param memberId
   * @param role
   */
  updateMemberRole: (teamId: string, memberId: string, role: string) =>
    patch(`/teams/${teamId}/members/${memberId}`, { role }),
  /**
   * Remove a member from a team.
   * @param teamId
   * @param memberId
   */
  removeMember: (teamId: string, memberId: string) => del(`/teams/${teamId}/members/${memberId}`),
  /**
   * List open pull requests across all repos in a team.
   * @param teamId
   */
  listOpenPRs: (teamId: string) =>
    get<
      {
        id: string;
        number: number;
        title: string;
        status: string;
        sourceBranch: string;
        targetBranch: string;
        createdAt: string;
        updatedAt: string;
        repo: { id: string; name: string; slug: string };
        author: { id: string; displayName: string; username: string; avatarUrl: string | null };
        _count?: { reviews: number; comments: number };
      }[]
    >(`/teams/${teamId}/open-prs`),
  /**
   * Get team activity feed.
   * @param teamId
   */
  getActivity: (teamId: string) =>
    get<
      {
        id: string;
        action: string;
        resourceType: string;
        resourceId: string;
        details: Record<string, unknown> | null;
        createdAt: string;
        user: { id: string; displayName: string; username: string; avatarUrl: string | null };
        resourceTitle: string | null;
        resourceLink: string | null;
        resourceKey: string | null;
      }[]
    >(`/teams/${teamId}/activity`),
  /**
   * Get a team member's profile with stats.
   * @param teamId
   * @param username
   */
  getMemberProfile: (teamId: string, username: string) =>
    get<{
      id: string;
      email: string;
      username: string;
      displayName: string;
      avatarUrl: string | null;
      createdAt: string;
      role: string;
      joinedAt: string;
      assignedIssuesCount: number;
      openPRsCount: number;
      recentActivity: {
        id: string;
        action: string;
        resourceType: string;
        resourceId: string;
        details: Record<string, unknown> | null;
        createdAt: string;
        user: { id: string; displayName: string; username: string; avatarUrl: string | null };
      }[];
    }>(`/teams/${teamId}/members/profile/${username}`),
};
