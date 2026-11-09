import { SCOPE_GROUPS } from './token-scopes';

export type AgentClient = 'claude-code' | 'codex' | 'other';

/** The clients offered on the connect page; `tokenName` is what a new token is called. */
export const AGENT_CLIENTS: { id: AgentClient; label: string; tokenName: string }[] = [
  { id: 'claude-code', label: 'Claude Code', tokenName: 'Claude Code' },
  { id: 'codex', label: 'Codex', tokenName: 'Codex' },
  { id: 'other', label: 'Other', tokenName: 'Agent' },
];

/** The scope groups an agent's token may get: every one but admin, which waits for a person. */
export const AGENT_SCOPE_GROUPS = SCOPE_GROUPS.filter((g) => g.area !== 'admin');

/** What an agent's token starts with: the widest scope of each group but admin. */
export const CONNECT_SCOPES: string[] = AGENT_SCOPE_GROUPS.flatMap((g) =>
  'readOnly' in g ? [`${g.area}:read`] : [`${g.area}:write`],
);

/** One copyable block shown after the token is created. */
export interface Snippet {
  label: string;
  value: string;
}

/**
 * The commands or config that connect a client to the MCP endpoint. /api/mcp reads
 * `Authorization: Token <token>` (src/middleware/auth.ts). Codex takes static headers from
 * `http_headers` under `[mcp_servers.<name>]` in ~/.codex/config.toml
 * (https://learn.chatgpt.com/docs/extend/mcp, formerly developers.openai.com/codex/mcp).
 * @param client - Which client to configure
 * @param origin - The site origin, without a trailing slash
 * @param token - The raw token
 */
export function agentSnippets(client: AgentClient, origin: string, token: string): Snippet[] {
  const url = new URL('api/mcp', `${origin}/`).href;
  const header = `Token ${token}`;
  if (client === 'claude-code') {
    return [
      {
        label: 'Command',
        value: `claude mcp add --transport http axiom ${url} --header "Authorization: ${header}"`,
      },
    ];
  }
  if (client === 'codex') {
    return [
      {
        label: '~/.codex/config.toml',
        value: `[mcp_servers.axiom]\nurl = "${url}"\nhttp_headers = { "Authorization" = "${header}" }`,
      },
    ];
  }
  return [
    { label: 'URL', value: url },
    { label: 'Header', value: `Authorization: ${header}` },
  ];
}

/**
 * The Claude Code command and the Codex config for one token, each labelled with its client: what
 * a page shows when it does not ask which client the token is for.
 * @param origin - The site origin, without a trailing slash
 * @param token - The raw token
 */
export function connectSnippets(origin: string, token: string): Snippet[] {
  return AGENT_CLIENTS.filter((c) => c.id !== 'other').flatMap((c) =>
    agentSnippets(c.id, origin, token).map((s) => ({ ...s, label: `${c.label}: ${s.label}` })),
  );
}
