/**
 * API token scopes. A token carries some of these; each request made with a token must be
 * covered by one of them. Session (JWT) requests are not scoped.
 *
 * - issues:read  - read projects, issues, sprints, boards and their settings
 * - issues:write - everything issues:read allows, plus creating and changing them
 * - wiki:read    - read wiki spaces and pages
 * - wiki:write   - everything wiki:read allows, plus creating and changing pages
 *
 * Reading the user's own profile, orgs, teams, search, notifications and attachments needs
 * any read scope (write scopes include read). Managing orgs, teams, members, invitations,
 * tokens, the account and anything under /api/admin is never allowed with a token.
 */
import type { Action } from '../utils/permissions';

export const TOKEN_SCOPES = ['issues:read', 'issues:write', 'wiki:read', 'wiki:write'] as const;
export type TokenScope = (typeof TOKEN_SCOPES)[number];

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

function has(scopes: readonly string[], area: 'issues' | 'wiki', write: boolean): boolean {
  return write
    ? scopes.includes(`${area}:write`)
    : scopes.includes(`${area}:read`) || scopes.includes(`${area}:write`);
}

/**
 * Which areas an API path belongs to. Anything not listed is token-forbidden for writes.
 * @param path - The request path, starting with /api
 */
function areaOf(path: string): 'issues' | 'wiki' | 'any' | 'none' {
  if (path.startsWith('/api/wiki')) return 'wiki';
  if (
    path.startsWith('/api/projects') ||
    path.startsWith('/api/issues') ||
    path.startsWith('/api/approval-requests') ||
    path.startsWith('/api/custom-fields') ||
    path.startsWith('/api/links') ||
    (path.startsWith('/api/teams/') && /\/(roadmap|analytics)/.test(path))
  ) {
    return 'issues';
  }
  if (path.startsWith('/api/attachments') || path.startsWith('/api/mcp')) return 'any';
  if (
    path.startsWith('/api/search') ||
    path.startsWith('/api/orgs') ||
    path.startsWith('/api/teams') ||
    path.startsWith('/api/users/me') ||
    path.startsWith('/api/users/search') ||
    path.startsWith('/api/notifications')
  ) {
    return 'any';
  }
  return 'none';
}

/**
 * Whether a token with these scopes may make this request.
 * @param scopes - The token's scopes
 * @param method - HTTP method
 * @param path - The request path, starting with /api
 */
export function tokenAllows(scopes: readonly string[], method: string, path: string): boolean {
  const write = !SAFE.has(method);
  // Tokens never manage tokens, the account or admin settings
  if (path.startsWith('/api/admin')) return false;
  if (path.startsWith('/api/users/me') && write) return false;
  const area = areaOf(path);
  if (area === 'issues' || area === 'wiki') return has(scopes, area, write);
  if (area === 'any') {
    // Attachments and MCP messages are checked again by their parent or tool
    if (path.startsWith('/api/attachments') || path.startsWith('/api/mcp')) {
      return write
        ? has(scopes, 'issues', true) || has(scopes, 'wiki', true)
        : has(scopes, 'issues', false) || has(scopes, 'wiki', false);
    }
    // Org, team, notification and search reads only; managing them is not for tokens
    if (write && !path.startsWith('/api/notifications')) return false;
    return has(scopes, 'issues', false) || has(scopes, 'wiki', false);
  }
  return false;
}

/**
 * The scope an MCP tool's action needs.
 * @param scopes - The token's scopes
 * @param action - The tool's permission action
 */
export function scopesAllowAction(scopes: readonly string[], action: Action): boolean {
  if (action === 'issue:view') return has(scopes, 'issues', false);
  if (action === 'issue:create' || action === 'issue:edit') return has(scopes, 'issues', true);
  if (action === 'wiki:view') return has(scopes, 'wiki', false);
  if (action === 'wiki:edit') return has(scopes, 'wiki', true);
  return false;
}
