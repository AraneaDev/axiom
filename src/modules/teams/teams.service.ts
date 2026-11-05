import { TeamRole } from '@prisma/client';

import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { revokeLiveAccess } from '../../realtime/access-revocation';
import { checkUnique } from '../../utils/check-unique';
import { ERR } from '../../utils/error-messages';
import { findOrThrow } from '../../utils/find-or-throw';
import { parsePagination, parseServicePagination, paginatedResponse } from '../../utils/pagination';
import { USER_BASIC_SELECT, USER_WITH_AVATAR_SELECT } from '../../utils/prisma-selects';
import { viewablePageIdFilter } from '../search/search-access';
import { canAccessSpace } from '../wiki/space-permissions.service';

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
  await findOrThrow(
    prisma.organization.findUnique({ where: { id: orgId }, select: { id: true } }),
    ERR.ORGANIZATION_NOT_FOUND,
  );
  await checkUnique('team', { orgId, slug: data.slug }, 'Team slug already taken in this org');

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
 * Retrieve a team by ID with members, projects, and wiki spaces.
 * @param teamId - The team ID
 * @returns The team with all related resources
 * @throws {AppError} 404 if team not found
 */
export async function getTeam(teamId: string) {
  return findOrThrow(
    prisma.team.findUnique({
      where: { id: teamId },
      include: {
        members: {
          include: {
            user: {
              select: {
                ...USER_BASIC_SELECT,
                isAdmin: true,
                orgMemberships: {
                  select: { orgId: true, role: true },
                },
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
        projects: { select: { id: true, name: true, slug: true, prefix: true } },
        wikiSpaces: { select: { id: true, name: true, slug: true } },
      },
    }),
    ERR.TEAM_NOT_FOUND,
  );
}

/**
 * List all teams in an organization with member/project counts and pagination.
 * @param orgId - The organization ID
 * @param query - Pagination query params (limit, offset)
 * @param query.limit
 * @param query.offset
 * @param viewerId
 * @returns Paginated list of teams with counts and wiki spaces
 */
export async function listOrgTeams(
  orgId: string,
  query: { limit?: string; offset?: string } = {},
  viewerId?: string,
) {
  const { take, skip } = parsePagination(query, { limit: 50 });
  // A GUEST only sees the teams they were added to
  const viewerRole = viewerId
    ? (
        await prisma.orgMembership.findUnique({
          where: { userId_orgId: { userId: viewerId, orgId } },
          select: { role: true },
        })
      )?.role
    : undefined;
  const where =
    viewerRole === 'GUEST' ? { orgId, members: { some: { userId: viewerId } } } : { orgId };

  const [teams, total] = await Promise.all([
    prisma.team.findMany({
      where,
      include: {
        _count: { select: { members: true, projects: true } },
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

  // Space names are only listed where the viewer may open the space
  if (viewerId) {
    for (const team of teams) {
      const allowed = await Promise.all(
        team.wikiSpaces.map((sp) => canAccessSpace(sp.id, viewerId, 'VIEW')),
      );
      team.wikiSpaces = team.wikiSpaces.filter((_, i) => allowed[i]);
    }
  }

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
  await findOrThrow(prisma.team.findUnique({ where: { id: teamId } }), ERR.TEAM_NOT_FOUND);
  return prisma.team.update({ where: { id: teamId }, data });
}

/**
 * Delete a team and all its associated data.
 * @param teamId - The team ID
 */
export async function deleteTeam(teamId: string) {
  await findOrThrow(prisma.team.findUnique({ where: { id: teamId } }), ERR.TEAM_NOT_FOUND);
  await prisma.team.delete({ where: { id: teamId } });
}

/**
 * List all members of a team with user details.
 * @param teamId - The team ID
 * @returns Array of team memberships with user details
 * @throws {AppError} 404 if team not found
 */
export async function listTeamMembers(teamId: string) {
  const team = await findOrThrow(
    prisma.team.findUnique({ where: { id: teamId } }),
    ERR.TEAM_NOT_FOUND,
  );

  return prisma.teamMembership.findMany({
    where: { teamId },
    include: {
      user: {
        select: {
          ...USER_BASIC_SELECT,
          isAdmin: true,
          // Only the membership in this team's org: a member's other orgs are not shown
          orgMemberships: {
            where: { orgId: team.orgId },
            select: { orgId: true, role: true },
          },
        },
      },
    },
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
  await checkUnique('teamMembership', { userId, teamId }, 'User is already a team member');

  // Verify user is in the org
  const team = await findOrThrow(
    prisma.team.findUnique({ where: { id: teamId } }),
    ERR.TEAM_NOT_FOUND,
  );

  const orgMember = await prisma.orgMembership.findUnique({
    where: { userId_orgId: { userId, orgId: team.orgId } },
  });
  if (!orgMember) throw new AppError(400, 'User must be an org member first');

  return prisma.teamMembership.create({
    data: { userId, teamId, role },
    include: {
      user: {
        select: {
          ...USER_BASIC_SELECT,
          isAdmin: true,
          // Only the membership in this team's org: a member's other orgs are not shown
          orgMemberships: {
            where: { orgId: team.orgId },
            select: { orgId: true, role: true },
          },
        },
      },
    },
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

  const updated = await prisma.teamMembership.update({
    where: { id: membership.id },
    data: { role },
  });
  // Space permissions can be granted per team role
  void revokeLiveAccess({ userId: memberId });
  return updated;
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
  // Issue watches in the team's projects would keep notifying someone who can no longer
  // open those issues
  await prisma.$transaction([
    prisma.issueWatcher.deleteMany({
      where: { userId: memberId, issue: { project: { teamId } } },
    }),
    prisma.teamMembership.delete({ where: { id: membership.id } }),
  ]);
  // Open sockets checked access when they joined: re-check them (not awaited)
  void revokeLiveAccess({ userId: memberId });
}

/**
 * Ids of the latest activity rows by these users on the team's own issues and on the
 * team's pages the viewer can open. Activity rows are keyed by resource id, so the match
 * runs in SQL (EXISTS joins) rather than through an id list, which a large team would push
 * past the query's bind limit.
 * @param teamId - The team
 * @param userIds - Whose activity
 * @param viewerId - Who is looking
 * @param limit - How many rows
 */
async function teamActivityIds(
  teamId: string,
  userIds: string[],
  viewerId: string,
  limit: number,
): Promise<string[]> {
  if (userIds.length === 0) return [];
  const { spaceIds, hiddenPageIds } = await viewablePageIdFilter(viewerId);
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT a.id FROM activities a
    WHERE a."userId" = ANY(${userIds})
      AND (
        (a."resourceType" = 'issue' AND EXISTS (
          SELECT 1 FROM issues i JOIN projects p ON p.id = i."projectId"
          WHERE i.id = a."resourceId" AND p."teamId" = ${teamId}
        ))
        OR (a."resourceType" = 'wiki_page' AND EXISTS (
          SELECT 1 FROM pages pg JOIN wiki_spaces s ON s.id = pg."spaceId"
          WHERE pg.id = a."resourceId" AND s."teamId" = ${teamId}
            AND pg."spaceId" = ANY(${spaceIds})
            AND NOT (pg.id = ANY(${hiddenPageIds}))
        ))
      )
    ORDER BY a."createdAt" DESC
    LIMIT ${limit}
  `;
  return rows.map((r) => r.id);
}

/**
 * Get recent activity across a team's projects.
 * @param teamId - The team ID
 * @param viewerId
 * @param rawLimit - Max results (default 20)
 * @returns List of recent activity entries with user info
 */
export async function getTeamActivity(teamId: string, viewerId: string, rawLimit = 20) {
  const limit = parseServicePagination({ limit: rawLimit }, 20).take;
  // Get all member user IDs for this team
  const members = await prisma.teamMembership.findMany({
    where: { teamId },
    select: { userId: true },
  });
  const memberIds = members.map((m: (typeof members)[number]) => m.userId);

  if (memberIds.length === 0) return [];

  const activities = await prisma.activity.findMany({
    // Only activity on this team's own issues and pages: members also work elsewhere
    where: { id: { in: await teamActivityIds(teamId, memberIds, viewerId, limit) } },
    include: {
      user: { select: USER_WITH_AVATAR_SELECT },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  // Hydrate with resource titles and links
  const teamOrgSelect = { slug: true, org: { select: { slug: true } } } as const;

  type Activity = (typeof activities)[number];
  const issueIds = activities
    .filter((a: Activity) => a.resourceType === 'issue')
    .map((a: Activity) => a.resourceId);
  const wikiIds = activities
    .filter((a: Activity) => a.resourceType === 'wiki_page')
    .map((a: Activity) => a.resourceId);

  const issueSelect = {
    id: true,
    number: true,
    title: true,
    project: { select: { slug: true, prefix: true, team: { select: teamOrgSelect } } },
  } as const;
  type IssueResult = Awaited<
    ReturnType<typeof prisma.issue.findMany<{ select: typeof issueSelect }>>
  >[number];

  const issues: IssueResult[] =
    issueIds.length > 0
      ? await prisma.issue.findMany({
          where: { id: { in: issueIds } },
          select: issueSelect,
        })
      : [];

  const wikiSelect = {
    id: true,
    title: true,
    slug: true,
    space: { select: { slug: true, team: { select: teamOrgSelect } } },
  } as const;
  type WikiResult = Awaited<
    ReturnType<typeof prisma.page.findMany<{ select: typeof wikiSelect }>>
  >[number];

  const wikiPages: WikiResult[] =
    wikiIds.length > 0
      ? await prisma.page.findMany({
          where: { id: { in: wikiIds } },
          select: wikiSelect,
        })
      : [];

  const issueMap = new Map(issues.map((i: (typeof issues)[number]) => [i.id, i] as const));
  const wikiMap = new Map(wikiPages.map((w: (typeof wikiPages)[number]) => [w.id, w] as const));

  return activities.map((a: Activity) => {
    let resourceTitle: string | null = null;
    let resourceLink: string | null = null;
    let resourceKey: string | null = null;

    if (a.resourceType === 'issue') {
      const issue = issueMap.get(a.resourceId);
      if (issue) {
        resourceTitle = issue.title;
        resourceKey = `${issue.project.prefix}-${issue.number}`;
        resourceLink = `/${issue.project.team.org.slug}/${issue.project.team.slug}/${issue.project.slug}/issues/${issue.number}`;
      }
    } else if (a.resourceType === 'wiki_page') {
      const page = wikiMap.get(a.resourceId);
      if (page) {
        resourceTitle = page.title;
        resourceLink = `/${page.space.team.org.slug}/${page.space.team.slug}/wiki/${page.space.slug}/${page.slug}`;
      }
    }

    return { ...a, resourceTitle, resourceLink, resourceKey };
  });
}

/**
 * Whether a viewer may see team members' emails: team ADMINs, org OWNERs/ADMINs and
 * platform admins.
 * @param viewerId
 * @param teamId
 */
export async function canSeeTeamEmails(viewerId: string, teamId: string): Promise<boolean> {
  const team = await prisma.team.findUnique({ where: { id: teamId }, select: { orgId: true } });
  if (!team) return false;
  const [user, orgMembership, teamMembership] = await Promise.all([
    prisma.user.findUnique({ where: { id: viewerId }, select: { isAdmin: true } }),
    prisma.orgMembership.findUnique({
      where: { userId_orgId: { userId: viewerId, orgId: team.orgId } },
    }),
    prisma.teamMembership.findUnique({ where: { userId_teamId: { userId: viewerId, teamId } } }),
  ]);
  return (
    user?.isAdmin === true ||
    orgMembership?.role === 'OWNER' ||
    orgMembership?.role === 'ADMIN' ||
    teamMembership?.role === 'ADMIN'
  );
}

/**
 * Get a member's profile with stats scoped to a team.
 * @param teamId - The team ID
 * @param username - The member's username
 * @param viewerId
 * @returns Profile info with assigned issues count and recent activity
 * @throws {AppError} 404 if user not found or not a team member
 */
export async function getTeamMemberProfile(teamId: string, username: string, viewerId: string) {
  const user = await findOrThrow(
    prisma.user.findUnique({
      where: { username },
      select: {
        id: true,
        email: true,
        username: true,
        displayName: true,
        avatarUrl: true,
        createdAt: true,
      },
    }),
    ERR.USER_NOT_FOUND,
  );

  const membership = await findOrThrow(
    prisma.teamMembership.findFirst({
      where: { teamId, userId: user.id },
    }),
    'User is not a member of this team',
  );

  // Get team's projects for scoped stats
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: {
      projects: { select: { id: true } },
    },
  });

  const projectIds = team?.projects.map((p: { id: string }) => p.id) ?? [];

  const [assignedIssuesCount, recentActivity] = await Promise.all([
    prisma.issue.count({
      where: {
        assigneeId: user.id,
        projectId: { in: projectIds },
        OR: [{ column: { isDone: false } }, { columnId: null }],
      },
    }),
    prisma.activity.findMany({
      // Only activity on this team's own issues and pages
      where: { id: { in: await teamActivityIds(teamId, [user.id], viewerId, 10) } },
      include: {
        user: { select: USER_WITH_AVATAR_SELECT },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
  ]);

  // Emails are for team ADMINs, org OWNERs/ADMINs and platform admins, as on the org page
  const { email, ...publicUser } = user;
  return {
    ...publicUser,
    ...((await canSeeTeamEmails(viewerId, teamId)) ? { email } : {}),
    role: membership.role,
    joinedAt: membership.createdAt,
    assignedIssuesCount,
    recentActivity,
  };
}
