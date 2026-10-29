import { prisma } from '../config/database';
import { AppError } from '../middleware/errorHandler';
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
  list_wiki_spaces: 'wiki:view',
  get_wiki_page: 'wiki:view',
  get_page_tree: 'wiki:view',
  create_wiki_page: 'wiki:edit',
  update_wiki_page: 'wiki:edit',
  search: 'issue:view',
  list_wiki_issue_links: 'wiki:view',
  link_wiki_to_issue: 'wiki:edit',
};

/**
 * Required ApiToken scopes per tool group:
 * "issues:read"  → list_issues, get_issue, search
 * "issues:write" → create_issue, add_comment
 * "wiki:read"    → list_wiki_spaces, get_wiki_page, get_page_tree
 * "wiki:write"   → create_wiki_page
 * @param toolName
 * @param orgId
 */
export async function assertMcpPermission(toolName: string, orgId: string): Promise<void> {
  const ctx = mcpContext.getStore();
  if (!ctx) throw new AppError(401, 'No MCP context');
  const action = MCP_TOOL_PERMISSIONS[toolName];
  if (!action) return; // unknown tool, allow

  const orgMembership = await prisma.orgMembership.findUnique({
    where: { userId_orgId: { orgId, userId: ctx.userId } },
  });
  if (!orgMembership) {
    throw new AppError(403, 'Forbidden');
  }

  const teamMembership = await prisma.teamMembership.findFirst({
    where: { userId: ctx.userId, team: { orgId } },
  });

  const allowed = hasPermission(orgMembership.role, teamMembership?.role ?? null, action);
  if (!allowed) {
    throw new AppError(403, 'Forbidden');
  }
}
