import { OrgRole, TeamRole } from '@prisma/client';

// Actions that can be checked
export type Action =
  | 'org:manage'
  | 'team:create'
  | 'team:delete'
  | 'team:manage_members'
  | 'project:create'
  | 'project:delete'
  | 'issue:create'
  | 'issue:edit'
  | 'issue:view'
  | 'wiki:create_space'
  | 'wiki:edit'
  | 'wiki:view'
  | 'api_key:manage_own'
  | 'api_key:manage_all'
  | 'audit:view';

// Org-level permission matrix
const orgPermissions: Record<OrgRole, Set<Action>> = {
  OWNER: new Set([
    'org:manage',
    'team:create',
    'team:delete',
    'team:manage_members',
    'project:create',
    'project:delete',
    'issue:create',
    'issue:edit',
    'issue:view',
    'wiki:create_space',
    'wiki:edit',
    'wiki:view',
    'api_key:manage_own',
    'api_key:manage_all',
    'audit:view',
  ]),
  ADMIN: new Set([
    'team:create',
    'team:delete',
    'team:manage_members',
    'project:create',
    'project:delete',
    'issue:create',
    'issue:edit',
    'issue:view',
    'wiki:create_space',
    'wiki:edit',
    'wiki:view',
    'api_key:manage_own',
    'api_key:manage_all',
    'audit:view',
  ]),
  MEMBER: new Set([
    'project:create',
    'issue:create',
    'issue:edit',
    'issue:view',
    'wiki:create_space',
    'wiki:edit',
    'wiki:view',
    'api_key:manage_own',
  ]),
  VIEWER: new Set(['issue:view', 'wiki:view']),
  GUEST: new Set([
    // Guest permissions are granted per-resource, not org-wide
  ]),
};

// Team-level permission overrides
const teamPermissions: Record<TeamRole, Set<Action>> = {
  ADMIN: new Set([
    'team:manage_members',
    'project:create',
    'project:delete',
    'issue:create',
    'issue:edit',
    'issue:view',
    'wiki:create_space',
    'wiki:edit',
    'wiki:view',
  ]),
  MEMBER: new Set([
    'project:create',
    'issue:create',
    'issue:edit',
    'issue:view',
    'wiki:create_space',
    'wiki:edit',
    'wiki:view',
  ]),
  VIEWER: new Set(['issue:view', 'wiki:view']),
};

/**
 *
 * @param role
 * @param action
 */
export function hasOrgPermission(role: OrgRole, action: Action): boolean {
  return orgPermissions[role]?.has(action) ?? false;
}

/**
 *
 * @param role
 * @param action
 */
export function hasTeamPermission(role: TeamRole, action: Action): boolean {
  return teamPermissions[role]?.has(action) ?? false;
}

/**
 * Check a permission on a team's resources (projects, issues, sprints, boards, the team's
 * wiki spaces). The team role wins: a user with a role on the team gets what that role
 * allows, and org OWNERs and ADMINs keep their full rights on top. A user with no role on
 * the team falls back to their org role.
 * @param orgRole - The user's role in the org that owns the team
 * @param teamRole - The user's role in the team, or null when not a member
 * @param action - The permission action
 */
export function hasPermission(
  orgRole: OrgRole,
  teamRole: TeamRole | null,
  action: Action,
): boolean {
  if (teamRole) {
    if (hasTeamPermission(teamRole, action)) return true;
    return (orgRole === 'OWNER' || orgRole === 'ADMIN') && hasOrgPermission(orgRole, action);
  }
  return hasOrgPermission(orgRole, action);
}
