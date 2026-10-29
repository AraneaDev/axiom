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
 * Check if a user has permission, considering both org and team roles.
 * Org OWNER/ADMIN always has access. Otherwise, check team role.
 * @param orgRole
 * @param teamRole
 * @param action
 */
export function hasPermission(
  orgRole: OrgRole,
  teamRole: TeamRole | null,
  action: Action,
): boolean {
  // Org-level permission always wins
  if (hasOrgPermission(orgRole, action)) return true;
  // Fall back to team-level permission
  if (teamRole && hasTeamPermission(teamRole, action)) return true;
  return false;
}
