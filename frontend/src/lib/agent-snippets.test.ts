import { describe, expect, it } from 'vitest';

import { agentSnippets } from './agent-snippets';

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
