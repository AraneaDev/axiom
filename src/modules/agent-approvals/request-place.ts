import { prisma } from '../../config/database';
import { canAccessSpace } from '../wiki/space-permissions.service';

/**
 * Where a request acts (decision 11): the teams of the projects, issues and sprints it names, and
 * the spaces of the spaces and pages it names. Both empty for an org-level request.
 */
export interface RequestPlace {
  teamIds: string[];
  spaceIds: string[];
}

/**
 * Every id of one field the input holds, as strings.
 * @param input - The validated input
 * @param field - The field name
 */
function idsOf(input: Record<string, unknown>, field: string): string[] {
  const value = input[field];
  if (typeof value === 'string' && value) return [value];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item !== '')
    : [];
}

/**
 * The place an action's input touches, read from the ids authorize reads: a team, or the team of
 * a project, issue or sprint, and a space, or the space of a page. Ids that name nothing add
 * nothing, as the action could not run on them either.
 * @param input - The action's validated input
 */
export async function placeOfInput(input: unknown): Promise<RequestPlace> {
  if (!input || typeof input !== 'object') return { teamIds: [], spaceIds: [] };
  const given = input as Record<string, unknown>;
  const issueIds = [...idsOf(given, 'issueId'), ...idsOf(given, 'issueIds')];
  const projectIds = idsOf(given, 'projectId');
  const sprintIds = idsOf(given, 'sprintId');
  const pageIds = idsOf(given, 'pageId');
  const [projects, issues, sprints, pages] = await Promise.all([
    projectIds.length
      ? prisma.project.findMany({ where: { id: { in: projectIds } }, select: { teamId: true } })
      : [],
    issueIds.length
      ? prisma.issue.findMany({
          where: { id: { in: issueIds } },
          select: { project: { select: { teamId: true } } },
        })
      : [],
    sprintIds.length
      ? prisma.sprint.findMany({
          where: { id: { in: sprintIds } },
          select: { project: { select: { teamId: true } } },
        })
      : [],
    pageIds.length
      ? prisma.page.findMany({ where: { id: { in: pageIds } }, select: { spaceId: true } })
      : [],
  ]);
  const teamIds = new Set(idsOf(given, 'teamId'));
  for (const row of projects) teamIds.add(row.teamId);
  for (const row of [...issues, ...sprints]) teamIds.add(row.project.teamId);
  const spaceIds = new Set(idsOf(given, 'spaceId'));
  for (const row of pages) spaceIds.add(row.spaceId);
  return { teamIds: [...teamIds].sort(), spaceIds: [...spaceIds].sort() };
}

/**
 * Whether a user can open every part of a place: a team as its projects are opened (a membership,
 * or a platform admin), a space by its view right. An org-level place is open to anyone asked.
 * @param userId - The user
 * @param place - The place
 */
export async function canOpenPlace(userId: string, place: RequestPlace): Promise<boolean> {
  if (place.teamIds.length === 0 && place.spaceIds.length === 0) return true;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { isAdmin: true } });
  if (user?.isAdmin) return true;
  if (place.teamIds.length > 0) {
    const member = await prisma.teamMembership.count({
      where: { userId, teamId: { in: place.teamIds } },
    });
    if (member !== place.teamIds.length) return false;
  }
  for (const spaceId of place.spaceIds) {
    if (!(await canAccessSpace(spaceId, userId, 'VIEW'))) return false;
  }
  return true;
}
