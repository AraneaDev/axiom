import { TeamRole } from '@prisma/client';

import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { findOrThrow } from '../../utils/find-or-throw';
import { parsePagination, paginatedResponse } from '../../utils/pagination';
import { USER_BASIC_SELECT, USER_WITH_AVATAR_SELECT } from '../../utils/prisma-selects';

/**
 * Create a new team within an organization, adding the creator as admin.
 * @param orgId - The organization to create the team in
 * @param userId - The user creating the team (becomes team admin)
 * @param data - Team creation data including name, slug, and optional description
 * @param data.name
 * @param data.slug
 * @param data.description
 * @returns The created team with members
 * @throws {AppError} 409 if team slug already taken in this org
 */
export async function createTeam(
  orgId: string,
  userId: string,
  data: { name: string; slug: string; description?: string },
) {
  const existing = await prisma.team.findUnique({
    where: { orgId_slug: { orgId, slug: data.slug } },
  });
  if (existing) throw new AppError(409, 'Team slug already taken in this org');

  return prisma.team.create({
    data: {
      orgId,
      name: data.name,
      slug: data.slug,
      description: data.description,
      members: {
        create: { userId, role: 'ADMIN' },
      },
    },
    include: {
      members: { include: { user: { select: USER_BASIC_SELECT } } },
    },
  });
}

/**
 * Retrieve a team by ID with members, repos, projects, and wiki spaces.
 * @param teamId - The team ID
 * @returns The team with all related resources
 * @throws {AppError} 404 if team not found
 */
export async function getTeam(teamId: string) {
  return findOrThrow(
    prisma.team.findUnique({
      where: { id: teamId },
      include: {
        members: { include: { user: { select: USER_BASIC_SELECT } } },
        repos: { select: { id: true, name: true, slug: true, visibility: true } },
        projects: { select: { id: true, name: true, slug: true, prefix: true } },
        wikiSpaces: { select: { id: true, name: true, slug: true } },
      },
    }),
    'Team not found',
  );
}

/**
 * List all teams in an organization with member/repo/project counts and pagination.
 * @param orgId - The organization ID
 * @param query - Pagination query params (limit, offset)
 * @param query.limit
 * @param query.offset
 * @returns Paginated list of teams with counts, repos, and wiki spaces
 */
export async function listOrgTeams(orgId: string, query: { limit?: string; offset?: string } = {}) {
  const { take, skip } = parsePagination(query, { limit: 50 });
  const where = { orgId };

  const [teams, total] = await Promise.all([
    prisma.team.findMany({
      where,
      include: {
        _count: { select: { members: true, repos: true, projects: true } },
        repos: {
          select: { id: true, name: true, slug: true, visibility: true },
          orderBy: { name: 'asc' },
        },
        wikiSpaces: {
          select: { id: true, name: true, slug: true, _count: { select: { pages: true } } },
          orderBy: { name: 'asc' },
        },
      },
      orderBy: { name: 'asc' },
      take,
      skip,
    }),
    prisma.team.count({ where }),
  ]);

  return paginatedResponse(teams, total, take, skip);
}

/**
 * Update a team's name or description.
 * @param teamId - The team ID
 * @param data - Partial update data for name and/or description
 * @param data.name
 * @param data.description
 * @returns The updated team record
 */
export async function updateTeam(teamId: string, data: { name?: string; description?: string }) {
  return prisma.team.update({ where: { id: teamId }, data });
}

/**
 * Delete a team and all its associated data.
 * @param teamId - The team ID
 */
export async function deleteTeam(teamId: string) {
  await prisma.team.delete({ where: { id: teamId } });
}

/**
 * List all members of a team with user details.
 * @param teamId - The team ID
 * @returns Array of team memberships with user details
 * @throws {AppError} 404 if team not found
 */
export async function listTeamMembers(teamId: string) {
  await findOrThrow(prisma.team.findUnique({ where: { id: teamId } }), 'Team not found');

  return prisma.teamMembership.findMany({
    where: { teamId },
    include: { user: { select: USER_BASIC_SELECT } },
    orderBy: { createdAt: 'asc' },
  });
}

/**
 * Add a user to a team, requiring they are already an org member.
 * @param teamId - The team ID
 * @param userId - The user to add
 * @param role - The team role to assign (defaults to MEMBER)
 * @returns The created team membership with user details
 * @throws {AppError} 409 if user is already a team member
 * @throws {AppError} 400 if user is not an org member
 * @throws {AppError} 404 if team not found
 */
export async function addTeamMember(
  teamId: string,
  userId: string,
  role: TeamRole = TeamRole.MEMBER,
) {
  const existing = await prisma.teamMembership.findUnique({
    where: { userId_teamId: { userId, teamId } },
  });
  if (existing) throw new AppError(409, 'User is already a team member');

  // Verify user is in the org
  const team = await findOrThrow(
    prisma.team.findUnique({ where: { id: teamId } }),
    'Team not found',
  );

  const orgMember = await prisma.orgMembership.findUnique({
    where: { userId_orgId: { userId, orgId: team.orgId } },
  });
  if (!orgMember) throw new AppError(400, 'User must be an org member first');

  return prisma.teamMembership.create({
    data: { userId, teamId, role },
    include: { user: { select: USER_BASIC_SELECT } },
  });
}

/**
 * Update a team member's role.
 * @param teamId - The team ID
 * @param memberId - The user whose role to update
 * @param role - The new team role
 * @returns The updated team membership record
 * @throws {AppError} 404 if team membership not found
 */
export async function updateTeamMemberRole(teamId: string, memberId: string, role: TeamRole) {
  const membership = await findOrThrow(
    prisma.teamMembership.findFirst({
      where: { userId: memberId, teamId },
    }),
    'Team membership not found',
  );

  return prisma.teamMembership.update({
    where: { id: membership.id },
    data: { role },
  });
}

/**
 * List open pull requests across all repositories in a team.
 * @param teamId - The team ID
 * @returns List of open PRs with repo and author info
 */
export async function listTeamOpenPRs(teamId: string) {
  const prs = await prisma.pullRequest.findMany({
    where: {
      status: 'OPEN',
      repo: { teamId },
    },
    include: {
      repo: { select: { id: true, name: true, slug: true } },
      _count: { select: { reviews: true, comments: true } },
    },
    orderBy: { updatedAt: 'desc' },
    take: 25,
  });

  // Fetch author info
  const authorIds = [...new Set(prs.map((pr) => pr.authorId))];
  const authors =
    authorIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: authorIds } },
          select: USER_BASIC_SELECT,
        })
      : [];
  const authorMap = new Map(authors.map((a) => [a.id, a]));

  return prs.map((pr) => ({
    ...pr,
    author: authorMap.get(pr.authorId) ?? {
      id: pr.authorId,
      displayName: 'Unknown',
      username: 'unknown',
      avatarUrl: null,
    },
  }));
}

/**
 * Remove a member from a team.
 * @param teamId - The team ID
 * @param memberId - The user to remove
 * @throws {AppError} 404 if team membership not found
 */
export async function removeTeamMember(teamId: string, memberId: string) {
  const membership = await findOrThrow(
    prisma.teamMembership.findFirst({
      where: { userId: memberId, teamId },
    }),
    'Team membership not found',
  );
  await prisma.teamMembership.delete({ where: { id: membership.id } });
}

/**
 * Get recent activity across a team's projects and repos.
 * @param teamId - The team ID
 * @param limit - Max results (default 20)
 * @returns List of recent activity entries with user info
 */
export async function getTeamActivity(teamId: string, limit = 20) {
  // Get all member user IDs for this team
  const members = await prisma.teamMembership.findMany({
    where: { teamId },
    select: { userId: true },
  });
  const memberIds = members.map((m) => m.userId);

  if (memberIds.length === 0) return [];

  return prisma.activity.findMany({
    where: { userId: { in: memberIds } },
    include: {
      user: { select: USER_WITH_AVATAR_SELECT },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

/**
 * Get a member's profile with stats scoped to a team.
 * @param teamId - The team ID
 * @param username - The member's username
 * @returns Profile info with assigned issues count, open PRs, and recent activity
 * @throws {AppError} 404 if user not found or not a team member
 */
export async function getTeamMemberProfile(teamId: string, username: string) {
  const user = await prisma.user.findUnique({
    where: { username },
    select: {
      id: true,
      email: true,
      username: true,
      displayName: true,
      avatarUrl: true,
      createdAt: true,
    },
  });
  if (!user) throw new AppError(404, 'User not found');

  const membership = await prisma.teamMembership.findFirst({
    where: { teamId, userId: user.id },
  });
  if (!membership) throw new AppError(404, 'User is not a member of this team');

  // Get team's projects and repos for scoped stats
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: {
      projects: { select: { id: true } },
      repos: { select: { id: true } },
    },
  });

  const projectIds = team?.projects.map((p) => p.id) ?? [];
  const repoIds = team?.repos.map((r) => r.id) ?? [];

  const [assignedIssuesCount, openPRsCount, recentActivity] = await Promise.all([
    prisma.issue.count({
      where: {
        assigneeId: user.id,
        projectId: { in: projectIds },
        OR: [{ column: { isDone: false } }, { columnId: null }],
      },
    }),
    prisma.pullRequest.count({
      where: {
        authorId: user.id,
        repoId: { in: repoIds },
        status: 'OPEN',
      },
    }),
    prisma.activity.findMany({
      where: { userId: user.id },
      include: {
        user: { select: USER_WITH_AVATAR_SELECT },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
  ]);

  return {
    ...user,
    role: membership.role,
    joinedAt: membership.createdAt,
    assignedIssuesCount,
    openPRsCount,
    recentActivity,
  };
}
