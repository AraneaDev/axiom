import type { Team, TeamMember } from '@/lib/types';

import { get, post, patch, del } from './client';

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
   * The members of a team for its member list: its service accounts too, each with its kind.
   * Pickers read `get` instead, which lists people only.
   * @param teamId
   */
  listMembers: (teamId: string) => get<TeamMember[]>(`/teams/${teamId}/members?includeBots=true`),
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
      email?: string;
      username: string;
      displayName: string;
      avatarUrl: string | null;
      createdAt: string;
      role: string;
      joinedAt: string;
      assignedIssuesCount: number;
      recentActivity: {
        id: string;
        action: string;
        resourceType: string;
        resourceId: string;
        details: Record<string, unknown> | null;
        createdAt: string;
        via: string | null;
        user: { id: string; displayName: string; username: string; avatarUrl: string | null };
      }[];
    }>(`/teams/${teamId}/members/profile/${username}`),
};
