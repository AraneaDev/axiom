/**
 * The scopes a new token can be given, by area, in display order. A readOnly area has no write
 * scope a token can get. Admin isn't here: no action uses it yet (INERT_SCOPES in
 * src/middleware/token-scopes.ts, which a test keeps this list equal to).
 */
export const SCOPE_GROUPS = [
  { area: 'search', label: 'Search', description: 'The read and search tools', readOnly: true },
  { area: 'issues', label: 'Issues', description: 'Issues, comments, labels and project settings' },
  { area: 'wiki', label: 'Wiki', description: 'Spaces and pages' },
  { area: 'files', label: 'Files', description: 'Attachments, with the scope of their parent' },
  { area: 'sprints', label: 'Sprints', description: 'Sprints, backlog and velocity' },
  { area: 'boards', label: 'Boards', description: 'Boards and their columns' },
  {
    area: 'orgs',
    label: 'Organizations',
    description: 'Organizations and their members',
    readOnly: true,
  },
  { area: 'teams', label: 'Teams', description: 'Teams and their members', readOnly: true },
  { area: 'projects', label: 'Projects', description: 'Projects themselves', readOnly: true },
  { area: 'dashboards', label: 'Dashboards', description: 'Saved queries and dashboards' },
  { area: 'forms', label: 'Forms', description: 'Forms and their submissions' },
  { area: 'automation', label: 'Automation', description: 'Automation rules' },
  { area: 'approvals', label: 'Approvals', description: 'Approval gates and votes' },
] as const;

/**
 * What a new token starts with: enough for an agent to find and read issues, pages and their
 * files. docs/axiom-mcp-server.md and docs/mcp-install-test-protocol.md name the same set.
 */
export const DEFAULT_SCOPES = ['search:read', 'issues:read', 'wiki:read', 'files:read'] as const;

/**
 * Turn one scope of an area on or off. Write includes read, so the set holds at most one of
 * the two; turning write off falls back to read.
 * @param scopes - The selected scopes
 * @param area - The area
 * @param kind - The toggle that changed
 * @param on - Its new state
 */
export function toggleScope(
  scopes: readonly string[],
  area: string,
  kind: 'read' | 'write',
  on: boolean,
): string[] {
  const others = scopes.filter((s) => s !== `${area}:read` && s !== `${area}:write`);
  if (on) return [...others, `${area}:${kind}`];
  return kind === 'write' ? [...others, `${area}:read`] : others;
}
