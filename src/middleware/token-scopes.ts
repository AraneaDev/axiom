/**
 * API token scopes. A token carries some of these; each request made with a token must be
 * covered by one of them. Session (JWT) requests are not scoped.
 *
 * There is one <area>:read and one <area>:write per area, and write includes read within its
 * own area only. Which area a path belongs to is decided by areaOf below.
 *
 * Some requests have no area scope of their own or are never open to a token:
 * - Reading the user's own profile, the user search and notifications needs read on issues
 *   or wiki; so does changing the user's notification state.
 * - Search returns only the areas the token covers: it needs search:read, then issues:read or
 *   wiki:read per section.
 * - Attachments need files:<kind> here and the scope of their parent (issue or page) in the
 *   attachments router.
 * - Team activity, member profiles and team analytics are issue data.
 * - Managing orgs, teams, members, invitations, tokens, the account and anything under
 *   /api/admin is never allowed with a token, and neither is changing space permissions or
 *   page restrictions or creating, changing or deleting projects. No scope opens these, so
 *   a write scope on orgs, teams, projects or search does nothing on these paths.
 */
import type { Action } from '../utils/permissions';

export const SCOPE_AREAS = [
  'issues',
  'sprints',
  'boards',
  'wiki',
  'files',
  'search',
  'orgs',
  'teams',
  'projects',
  'dashboards',
  'forms',
  'automation',
  'approvals',
  'admin',
] as const;
export type ScopeArea = (typeof SCOPE_AREAS)[number];
export type TokenScope = `${ScopeArea}:${'read' | 'write'}`;

export const TOKEN_SCOPES: readonly TokenScope[] = SCOPE_AREAS.flatMap((area): TokenScope[] => [
  `${area}:read`,
  `${area}:write`,
]);

/**
 * What each scope stored before scopes per area became. These reproduce the old reach, and
 * the migration 20261104120000_token_scope_areas holds the same table.
 *
 * Only areas the old scope could really write get a write scope. The old rules refused every
 * write on projects (create, change, delete), orgs, teams, saved searches and the account,
 * so legacy tokens hold projects:read, orgs:read, teams:read, search:read and dashboards:read
 * only, and nothing under admin. Team, org and search reads were open to any old scope.
 */
export const LEGACY_SCOPE_MAP: Record<
  'issues:read' | 'issues:write' | 'wiki:read' | 'wiki:write',
  TokenScope[]
> = {
  'issues:read': [
    'issues:read',
    'sprints:read',
    'boards:read',
    'projects:read',
    'forms:read',
    'automation:read',
    'approvals:read',
    'dashboards:read',
    'files:read',
    'search:read',
    'orgs:read',
    'teams:read',
  ],
  'issues:write': [
    'issues:write',
    'sprints:write',
    'boards:write',
    'projects:read',
    'forms:write',
    'automation:write',
    'approvals:write',
    'dashboards:read',
    'files:write',
    'search:read',
    'orgs:read',
    'teams:read',
  ],
  'wiki:read': ['wiki:read', 'files:read', 'search:read', 'orgs:read', 'teams:read'],
  'wiki:write': ['wiki:write', 'files:write', 'search:read', 'orgs:read', 'teams:read'],
};

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Writes a token may never make, whatever its scopes */
const ACCESS_CONTROL = [
  /^\/api\/wiki\/spaces\/[^/]+\/permissions(\/|$)/,
  /^\/api\/wiki\/pages\/[^/]+\/restrictions$/,
  /^\/api\/wiki\/restrictions\//,
  /^\/api\/projects\/team\/[^/]+$/,
  /^\/api\/projects\/[^/]+$/,
];

/** The areas below a project with a scope of their own. All others are issue data. */
const PROJECT_SUBPATH_AREAS = new Map<string, ScopeArea>([
  ['sprints', 'sprints'],
  ['velocity', 'sprints'],
  ['backlog', 'sprints'],
  ['board', 'boards'],
  ['forms', 'forms'],
  ['intake', 'forms'],
  ['automation-rules', 'automation'],
  ['approval-gates', 'approvals'],
]);

/**
 * Whether the scopes cover reading (or writing) one area. Write includes read for the same
 * area, and for no other.
 * @param scopes - The token's scopes
 * @param area - The area
 * @param kind - read or write
 */
export function scopeAllows(
  scopes: readonly string[],
  area: ScopeArea,
  kind: 'read' | 'write',
): boolean {
  return scopes.includes(`${area}:write`) || (kind === 'read' && scopes.includes(`${area}:read`));
}

/**
 * Whether a name is a scope a token can hold.
 * @param scope - The name to check
 */
export function isTokenScope(scope: string): scope is TokenScope {
  return (TOKEN_SCOPES as readonly string[]).includes(scope);
}

/**
 * Whether the scopes cover reading (or writing) one area. For routes whose area depends
 * on the record, such as attachments (an issue's or a page's).
 * @param scopes - The token's scopes
 * @param area - issues or wiki
 * @param write - Whether the request writes
 */
export function scopesCover(
  scopes: readonly string[],
  area: 'issues' | 'wiki',
  write: boolean,
): boolean {
  return scopeAllows(scopes, area, write ? 'write' : 'read');
}

/**
 * The area of a path under /api/projects. Everything that isn't the project itself or has no
 * area of its own (labels, milestones, workflows, custom fields, ...) is issue data, which
 * also keeps those writes out of projects:write.
 * @param path - The request path, starting with /api/projects
 */
function projectAreaOf(path: string): ScopeArea {
  if (/^\/api\/projects\/team\/[^/]+$/.test(path) || /^\/api\/projects\/[^/]+$/.test(path)) {
    return 'projects';
  }
  return PROJECT_SUBPATH_AREAS.get(path.split('/')[4]) ?? 'issues';
}

/**
 * Which area an API path belongs to. Anything not listed is token-forbidden.
 * - personal: the user's own profile and notifications, and the user search
 * - mcp: MCP messages, checked again per tool
 * @param path - The request path, starting with /api
 */
function areaOf(path: string): ScopeArea | 'personal' | 'mcp' | 'none' {
  if (path.startsWith('/api/wiki')) return 'wiki';
  if (path.startsWith('/api/projects')) return projectAreaOf(path);
  if (path.startsWith('/api/approval-requests')) return 'approvals';
  if (
    path.startsWith('/api/issues') ||
    path.startsWith('/api/custom-fields') ||
    path.startsWith('/api/links') ||
    // Team views made of issue data: roadmap, analytics, activity and member profiles
    /^\/api\/teams\/[^/]+\/(roadmap\/timeline|analytics|activity)$/.test(path) ||
    /^\/api\/teams\/[^/]+\/members\/profile\/[^/]+$/.test(path)
  ) {
    return 'issues';
  }
  if (path === '/api/users/me/dashboard') return 'dashboards';
  if (path.startsWith('/api/attachments')) return 'files';
  if (path.startsWith('/api/mcp')) return 'mcp';
  if (path.startsWith('/api/search')) return 'search';
  if (path.startsWith('/api/orgs')) return 'orgs';
  if (path.startsWith('/api/teams')) return 'teams';
  if (
    path.startsWith('/api/users/me') ||
    path.startsWith('/api/users/search') ||
    path.startsWith('/api/notifications')
  ) {
    return 'personal';
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
  const kind = write ? 'write' : 'read';
  // Tokens never manage tokens, the account or admin settings
  if (path.startsWith('/api/admin')) return false;
  if (path.startsWith('/api/users/me') && write) return false;
  // Nor change access control or delete what holds data: space permissions, page
  // restrictions, creating, changing or deleting projects
  if (write && ACCESS_CONTROL.some((re) => re.test(path))) return false;
  const area = areaOf(path);
  if (area === 'none') return false;
  // MCP messages are checked again by their tool
  if (area === 'mcp') {
    return scopeAllows(scopes, 'issues', kind) || scopeAllows(scopes, 'wiki', kind);
  }
  // Notification state may be written with a read scope; it only touches the user's own
  if (area === 'personal') {
    if (write && !path.startsWith('/api/notifications')) return false;
    return scopeAllows(scopes, 'issues', 'read') || scopeAllows(scopes, 'wiki', 'read');
  }
  // Org, team and search reads only; managing them is not for tokens
  if (write && (area === 'orgs' || area === 'teams' || area === 'search')) return false;
  // The dashboard is issue data, so issues:read opens it as well
  if (area === 'dashboards' && scopeAllows(scopes, 'issues', 'read')) return true;
  return scopeAllows(scopes, area, kind);
}

/**
 * The scope an MCP tool's action needs.
 * @param scopes - The token's scopes
 * @param action - The tool's permission action
 */
export function scopesAllowAction(scopes: readonly string[], action: Action): boolean {
  if (action === 'issue:view') return scopeAllows(scopes, 'issues', 'read');
  if (action === 'issue:create' || action === 'issue:edit') {
    return scopeAllows(scopes, 'issues', 'write');
  }
  if (action === 'wiki:view') return scopeAllows(scopes, 'wiki', 'read');
  if (action === 'wiki:edit') return scopeAllows(scopes, 'wiki', 'write');
  return false;
}

/**
 * The path as Express routes it, for matching: Express 5 routing is case-insensitive and
 * non-strict, so `/api/Projects/x/` reaches the same handler as `/api/projects/x`. Decode
 * percent-escapes, lower-case, collapse repeated slashes and drop trailing ones, so every
 * spelling meets the same rule. Use on the path without its query string.
 * @param path - The raw request path
 */
export function normalizeApiPath(path: string): string {
  let decoded = path;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    // Malformed escapes: match the raw path (Express would refuse it anyway)
  }
  const collapsed = decoded.toLowerCase().replace(/\/{2,}/g, '/');
  const trimmed = collapsed.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}
