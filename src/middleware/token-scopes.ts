/**
 * API token scopes. A token carries some of these; each request made with a token must be
 * covered by one of them. Session (JWT) requests are not scoped.
 *
 * There is one <area>:read and one <area>:write per area, and write includes read within its
 * own area only. Every request a token makes runs a registry action, and the action's area and
 * kind say which scope covers it (src/actions/execute.ts). An unknown path answers 404.
 *
 * Some actions are never open to a token (uiOnly, tokenBlocked), and every admin action waits
 * for a person. Attachments need files:<kind> and the scope of their parent (issue or page).
 */
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
  'github',
] as const;
export type ScopeArea = (typeof SCOPE_AREAS)[number];
export type TokenScope = `${ScopeArea}:${'read' | 'write'}`;

export const TOKEN_SCOPES: readonly TokenScope[] = SCOPE_AREAS.flatMap((area): TokenScope[] => [
  `${area}:read`,
  `${area}:write`,
]);

/**
 * Scopes no action or route honours yet. A token holding one would gain that reach silently the
 * day the area gets its actions, so they can't be minted until then. Everything that manages orgs,
 * teams and projects is in area admin, where each call waits for a person, so these stay shut.
 */
export const INERT_SCOPES: readonly TokenScope[] = [
  'orgs:write',
  'teams:write',
  'projects:write',
  'search:write',
];

/** The scopes a new token can be given. */
export const MINTABLE_SCOPES = TOKEN_SCOPES.filter((scope) => !INERT_SCOPES.includes(scope));

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
 * Whether a new token can be given this scope.
 * @param scope - The name to check
 */
export function isMintableScope(scope: string): scope is TokenScope {
  return (MINTABLE_SCOPES as readonly string[]).includes(scope);
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
 * The path as Express routes it, for matching: Express 5 routing is case-insensitive and
 * non-strict, so `/api/Projects/x/` reaches the same handler as `/api/projects/x`. Decode
 * percent-escapes, lower-case, collapse repeated slashes and drop trailing ones, so every
 * spelling meets the same rule. Use on the path from requestPathname.
 *
 * An encoded slash or backslash stays encoded: Express keeps it inside one segment, so
 * `/api/projects/a%2Fb` routes as the project `a/b`, and must read as a project here too.
 * @param path - The raw request path
 */
export function normalizeApiPath(path: string): string {
  let decoded = path;
  try {
    decoded = decodeURIComponent(path.replace(/%(2f|5c)/gi, '%25$1'));
  } catch {
    // Malformed escapes: match the raw path (Express would refuse it anyway)
  }
  const collapsed = decoded.toLowerCase().replace(/\/{2,}/g, '/');
  const trimmed = collapsed.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}
