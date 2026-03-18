import { prisma } from '../config/database';
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
  list_repos: 'repo:read',
  browse_files: 'repo:read',
  read_file: 'repo:read',
  get_commits: 'repo:read',
  get_branches: 'repo:read',
  get_diff: 'repo:read',
  list_pull_requests: 'repo:read',
  list_wiki_spaces: 'wiki:view',
  get_wiki_page: 'wiki:view',
  get_page_tree: 'wiki:view',
  create_wiki_page: 'wiki:edit',
  search: 'issue:view',
};

/**
 * Required ApiToken scopes per tool group:
 * "issues:read"  → list_issues, get_issue, search
 * "issues:write" → create_issue, add_comment
 * "repo:read"    → list_repos, browse_files, read_file, get_commits, get_branches, get_diff, list_pull_requests
 * "wiki:read"    → list_wiki_spaces, get_wiki_page, get_page_tree
 * "wiki:write"   → create_wiki_page
 * @param toolName
 * @param orgId
 */
export async function assertMcpPermission(toolName: string, orgId: string): Promise<void> {
  const ctx = mcpContext.getStore();
  if (!ctx) throw new Error('No MCP context');
  const action = MCP_TOOL_PERMISSIONS[toolName];
  if (!action) return; // unknown tool, allow

  const orgMembership = await prisma.orgMembership.findUnique({
    where: { orgId_userId: { orgId, userId: ctx.userId } },
  });
  if (!orgMembership) {
    throw Object.assign(new Error('Forbidden'), { status: 403, code: 'FORBIDDEN' });
  }

  const teamMembership = await prisma.teamMembership.findFirst({
    where: { userId: ctx.userId, team: { orgId } },
  });

  const allowed = hasPermission(orgMembership.role, teamMembership?.role ?? null, action);
  if (!allowed) {
    throw Object.assign(new Error('Forbidden'), { status: 403, code: 'FORBIDDEN' });
  }
}
