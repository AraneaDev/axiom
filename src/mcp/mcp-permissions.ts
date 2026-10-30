import type { SpacePermissionLevel } from '@prisma/client';

import { prisma } from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { checkTeamPermission, checkTeamRead, checkWikiSpaceOrgAccess } from '../middleware/rbac';
import { checkProjectAccess } from '../middleware/requireProjectAccess';
import { scopesAllowAction } from '../middleware/token-scopes';
import { canAccessSpace } from '../modules/wiki/space-permissions.service';
import { canEditPage, canViewPage } from '../modules/wiki/wiki-permissions.service';
import { ERR } from '../utils/error-messages';
import type { Action } from '../utils/permissions';
import { hasPermission } from '../utils/permissions';

import { mcpContext } from './context';

export const MCP_TOOL_PERMISSIONS: Record<string, Action> = {
  list_orgs: 'issue:view',
  list_teams: 'issue:view',
  list_projects: 'issue:view',
  list_issues: 'issue:view',
  get_issue: 'issue:view',
  create_issue: 'issue:create',
  add_comment: 'issue:edit',
  update_issue: 'issue:edit',
  // The permission model has no separate delete action for issues; REST lets the same
  // roles edit and delete them
  delete_issue: 'issue:edit',
  list_sprints: 'issue:view',
  get_sprint: 'issue:view',
  create_sprint: 'issue:edit',
  start_sprint: 'issue:edit',
  complete_sprint: 'issue:edit',
  add_issues_to_sprint: 'issue:edit',
  list_wiki_spaces: 'wiki:view',
  get_wiki_page: 'wiki:view',
  get_page_tree: 'wiki:view',
  create_wiki_page: 'wiki:edit',
  update_wiki_page: 'wiki:edit',
  delete_wiki_page: 'wiki:edit',
  search: 'issue:view',
  list_wiki_issue_links: 'wiki:view',
  link_wiki_to_issue: 'wiki:edit',
};

/**
 * The action a tool needs. Fails closed: a tool without a mapping is refused, never waved
 * through.
 * @param toolName
 */
function actionFor(toolName: string): Action {
  const action = Object.hasOwn(MCP_TOOL_PERMISSIONS, toolName)
    ? MCP_TOOL_PERMISSIONS[toolName]
    : undefined;
  if (!action) throw new AppError(403, `No permission mapping for MCP tool ${toolName}`);
  // A call made with an API token is limited to the token's scopes
  const scopes = mcpContext.getStore()?.scopes;
  if (scopes && !scopesAllowAction(scopes, action)) {
    throw new AppError(403, `This API token does not have the scope for ${toolName}`);
  }
  return action;
}

function currentUserId(): string {
  const ctx = mcpContext.getStore();
  if (!ctx) throw new AppError(401, 'No MCP context');
  return ctx.userId;
}

async function isSystemAdmin(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { isAdmin: true } });
  return user?.isAdmin === true;
}

/**
 * The tool's action must be allowed by the user's org role or by their role in the team
 * that owns the resource, as `requireTeamPermission` decides on the REST side.
 * @param userId
 * @param teamId
 * @param action
 */
async function assertTeamRole(userId: string, teamId: string, action: Action): Promise<void> {
  const access = await checkTeamPermission(userId, teamId, action);
  if (access === 'not_found') throw new AppError(404, ERR.TEAM_NOT_FOUND);
  if (access !== 'ok') throw new AppError(403, 'Forbidden');
}

/**
 * Org-wide tools (list_teams): the user must be in the org, and the action must be allowed
 * by their org role or their role in at least one of the org's teams.
 * @param toolName
 * @param orgId
 */
export async function assertMcpPermission(toolName: string, orgId: string): Promise<void> {
  const userId = currentUserId();
  const action = actionFor(toolName);

  const orgMembership = await prisma.orgMembership.findUnique({
    where: { userId_orgId: { orgId, userId } },
  });
  if (!orgMembership) throw new AppError(403, 'Forbidden');

  const teamRoles = await prisma.teamMembership.findMany({
    where: { userId, team: { orgId } },
    select: { role: true },
  });
  const allowed =
    hasPermission(orgMembership.role, null, action) ||
    teamRoles.some((t) => hasPermission(orgMembership.role, t.role, action));
  if (!allowed) throw new AppError(403, 'Forbidden');
}

/**
 * Team-scoped tools (list_projects, list_wiki_spaces): as `requireTeamPermission`.
 * @param toolName
 * @param teamId
 */
export async function assertMcpTeamPermission(toolName: string, teamId: string): Promise<void> {
  await assertTeamRole(currentUserId(), teamId, actionFor(toolName));
}

/**
 * Team-wide reads (list_projects): team membership, org OWNER/ADMIN or platform admin, as
 * the REST team routes; then the tool's action against the role.
 * @param toolName
 * @param teamId
 */
export async function assertMcpTeamRead(toolName: string, teamId: string): Promise<void> {
  const userId = currentUserId();
  const action = actionFor(toolName);
  const access = await checkTeamRead(userId, teamId);
  if (access === 'not_found') throw new AppError(404, ERR.TEAM_NOT_FOUND);
  if (access === 'forbidden') throw new AppError(403, 'Forbidden');
  if (await isSystemAdmin(userId)) return;
  await assertTeamRole(userId, teamId, action);
}

/**
 * Project and issue tools: the REST project check (team member or system admin), then the
 * tool's action against the role in the project's own team.
 * @param toolName
 * @param projectId
 */
export async function assertMcpProjectPermission(
  toolName: string,
  projectId: string,
): Promise<void> {
  const userId = currentUserId();
  const action = actionFor(toolName);
  const access = await checkProjectAccess(userId, projectId);
  if (access === 'not_found') throw new AppError(404, ERR.PROJECT_NOT_FOUND);
  if (access === 'forbidden') throw new AppError(403, 'Forbidden');
  if (await isSystemAdmin(userId)) return;
  const project = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    select: { teamId: true },
  });
  await assertTeamRole(userId, project.teamId, action);
}

/**
 * Wiki space tools: the REST space checks (org membership, then the space permission at the
 * given level), then the tool's action against the role in the space's own team.
 * @param toolName
 * @param spaceId
 * @param level - VIEW for reads, EDIT for writes
 */
export async function assertMcpSpacePermission(
  toolName: string,
  spaceId: string,
  level: SpacePermissionLevel,
): Promise<void> {
  const userId = currentUserId();
  const action = actionFor(toolName);
  const orgAccess = await checkWikiSpaceOrgAccess(spaceId, userId);
  if (orgAccess === 'not_found') throw new AppError(404, ERR.SPACE_NOT_FOUND);
  if (orgAccess === 'forbidden') throw new AppError(403, 'Forbidden');
  if (!(await canAccessSpace(spaceId, userId, level))) throw new AppError(403, 'Forbidden');
  const space = await prisma.wikiSpace.findUniqueOrThrow({
    where: { id: spaceId },
    select: { teamId: true },
  });
  await assertTeamRole(userId, space.teamId, action);
}

/**
 * Wiki page tools: the space checks, then the page's own view or edit restrictions.
 * @param toolName
 * @param pageId
 * @param mode - 'view' for reads, 'edit' for writes
 */
export async function assertMcpPagePermission(
  toolName: string,
  pageId: string,
  mode: 'view' | 'edit',
): Promise<void> {
  const userId = currentUserId();
  const page = await prisma.page.findUnique({ where: { id: pageId }, select: { spaceId: true } });
  if (!page) throw new AppError(404, ERR.PAGE_NOT_FOUND);
  await assertMcpSpacePermission(toolName, page.spaceId, mode === 'view' ? 'VIEW' : 'EDIT');
  const allowed =
    mode === 'view' ? await canViewPage(userId, pageId) : await canEditPage(userId, pageId);
  if (!allowed) throw new AppError(403, 'Forbidden');
}
