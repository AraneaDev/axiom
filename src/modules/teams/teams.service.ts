import { TeamRole } from '@prisma/client';

import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { findOrThrow } from '../../utils/find-or-throw';
import { parsePagination, paginatedResponse } from '../../utils/pagination';
import { USER_BASIC_SELECT } from '../../utils/prisma-selects';

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
