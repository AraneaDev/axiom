import { describe, expect, it } from 'vitest';

import { agentSnippets, CONNECT_SCOPES, connectSnippets } from './agent-snippets';

const origin = 'https://axiom.example.test';
const token = 'tk_abc123';

describe('agentSnippets', () => {
  it('pins the Claude Code command', () => {
    expect(agentSnippets('claude-code', origin, token)).toEqual([
      {
        label: 'Command',
        value:
          'claude mcp add --transport http axiom https://axiom.example.test/api/mcp --header "Authorization: Token tk_abc123"',
      },
    ]);
  });

  it('pins the Codex config block', () => {
    expect(agentSnippets('codex', origin, token)[0].value).toBe(
      '[mcp_servers.axiom]\nurl = "https://axiom.example.test/api/mcp"\nhttp_headers = { "Authorization" = "Token tk_abc123" }',
    );
  });

  it('gives the URL and header for other clients', () => {
    expect(agentSnippets('other', origin, token).map((s) => s.value)).toEqual([
      'https://axiom.example.test/api/mcp',
      'Authorization: Token tk_abc123',
    ]);
  });
});

describe('connectSnippets', () => {
  it('gives the Claude Code command and the Codex config, each named for its client', () => {
    const snippets = connectSnippets(origin, token);
    expect(snippets.map((s) => s.label)).toEqual([
      'Claude Code: Command',
      'Codex: ~/.codex/config.toml',
    ]);
    expect(snippets.every((s) => s.value.includes(`Token ${token}`))).toBe(true);
  });

  it('offers an agent every scope but admin', () => {
    expect(CONNECT_SCOPES.length).toBeGreaterThan(0);
    expect(CONNECT_SCOPES.some((s) => s.startsWith('admin:'))).toBe(false);
  });
});
