/**
 * Which orgs a record belongs to, read from the database. An action whose input names no project,
 * team or space declares one of these, so the org's approval rules bind it (A12). A record shared
 * with no one else belongs to no org.
 */
import { prisma } from '../config/database';

const TEAM_ORG = { select: { orgId: true } } as const;
const PROJECT_ORG = { select: { team: TEAM_ORG } } as const;
const SPACE_ORG = { select: { team: TEAM_ORG } } as const;

/**
 * The orgs of projects.
 * @param projectIds - Project ids
 */
export async function orgsOfProjects(projectIds: readonly string[]): Promise<string[]> {
  if (projectIds.length === 0) return [];
  const rows = await prisma.project.findMany({
    where: { id: { in: [...projectIds] } },
    select: { team: TEAM_ORG },
  });
  return rows.map((row) => row.team.orgId);
}

/**
 * The orgs of spaces.
 * @param spaceIds - Space ids
 */
export async function orgsOfSpaces(spaceIds: readonly string[]): Promise<string[]> {
  if (spaceIds.length === 0) return [];
  const rows = await prisma.wikiSpace.findMany({
    where: { id: { in: [...spaceIds] } },
    select: { team: TEAM_ORG },
  });
  return rows.map((row) => row.team.orgId);
}

/**
 * The org a shared dashboard or saved query is shared with: its own org, or the one of its team
 * or project. A private one has none.
 * @param row - The record's sharing columns
 * @param row.orgId
 * @param row.team
 * @param row.project
 */
function sharedOrgs(row: {
  orgId: string | null;
  team: { orgId: string } | null;
  project?: { team: { orgId: string } } | null;
}): string[] {
  return [row.orgId, row.team?.orgId, row.project?.team.orgId].filter(
    (orgId): orgId is string => typeof orgId === 'string',
  );
}

/**
 * The orgs a dashboard is shared with.
 * @param dashboardId - The dashboard
 */
export async function orgsOfDashboard(dashboardId: string): Promise<string[]> {
  const row = await prisma.dashboard.findUnique({
    where: { id: dashboardId },
    select: { orgId: true, team: TEAM_ORG },
  });
  return row ? sharedOrgs(row) : [];
}

/**
 * The orgs a saved query is shared with, or belongs to through its project.
 * @param filterId - The saved query
 */
export async function orgsOfSavedQuery(filterId: string): Promise<string[]> {
  const row = await prisma.savedFilter.findUnique({
    where: { id: filterId },
    select: { orgId: true, team: TEAM_ORG, project: PROJECT_ORG },
  });
  return row ? sharedOrgs(row) : [];
}

/**
 * The org of the issue, page or comment an attachment hangs on. A staged file has none.
 * @param attachmentId - The attachment
 */
export async function orgsOfAttachment(attachmentId: string): Promise<string[]> {
  const row = await prisma.attachment.findUnique({
    where: { id: attachmentId },
    select: {
      issue: { select: { project: PROJECT_ORG } },
      page: { select: { space: SPACE_ORG } },
      comment: { select: { issue: { select: { project: PROJECT_ORG } } } },
    },
  });
  if (!row) return [];
  const orgs = [
    row.issue?.project.team.orgId,
    row.page?.space.team.orgId,
    row.comment?.issue?.project.team.orgId,
  ];
  return orgs.filter((orgId): orgId is string => typeof orgId === 'string');
}
