import { TeamRole } from '@prisma/client';

import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { findOrThrow } from '../../utils/find-or-throw';
import { parsePagination, paginatedResponse } from '../../utils/pagination';
import { USER_BASIC_SELECT } from '../../utils/prisma-selects';

/**
 *
 * @param orgId
 * @param userId
 * @param data
 * @param data.name
 * @param data.slug
 * @param data.description
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
 *
 * @param teamId
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
 *
 * @param orgId
 * @param query
 * @param query.limit
 * @param query.offset
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
 *
 * @param teamId
 * @param data
 * @param data.name
 * @param data.description
 */
export async function updateTeam(teamId: string, data: { name?: string; description?: string }) {
  return prisma.team.update({ where: { id: teamId }, data });
}

/**
 *
 * @param teamId
 */
export async function deleteTeam(teamId: string) {
  await prisma.team.delete({ where: { id: teamId } });
}

/**
 *
 * @param teamId
 * @param userId
 * @param role
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
 *
 * @param teamId
 * @param memberId
 * @param role
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
 *
 * @param teamId
 * @param memberId
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
