import { describe, expect, it } from 'vitest';

import { INERT_SCOPES, MINTABLE_SCOPES, scopeAllows } from '../../../src/middleware/token-scopes';

import { DEFAULT_SCOPES, SCOPE_GROUPS, toggleScope } from './token-scopes';

describe('the token form scopes', () => {
  it('default to a token that can read and search', () => {
    expect(scopeAllows(DEFAULT_SCOPES, 'search', 'read')).toBe(true);
    expect(scopeAllows(DEFAULT_SCOPES, 'issues', 'read')).toBe(true);
    expect(scopeAllows(DEFAULT_SCOPES, 'wiki', 'read')).toBe(true);
    expect(scopeAllows(DEFAULT_SCOPES, 'files', 'read')).toBe(true);
  });

  it('offer exactly what the API mints', () => {
    const offered = SCOPE_GROUPS.flatMap((group) =>
      'readOnly' in group ? [`${group.area}:read`] : [`${group.area}:read`, `${group.area}:write`],
    );
    expect([...offered].sort()).toEqual([...MINTABLE_SCOPES].sort());
    for (const scope of INERT_SCOPES) expect(offered).not.toContain(scope);
  });

  it('default to scopes the API mints', () => {
    for (const scope of DEFAULT_SCOPES) expect(MINTABLE_SCOPES).toContain(scope);
  });

  it('start with what the read and search tools need', () => {
    expect(SCOPE_GROUPS[0].area).toBe('search');
  });
});

describe('toggleScope', () => {
  it('replaces read with write, and falls back to read', () => {
    const on = toggleScope(['issues:read'], 'issues', 'write', true);
    expect(on).toEqual(['issues:write']);
    expect(toggleScope(on, 'issues', 'write', false)).toEqual(['issues:read']);
  });

  it('drops the area when read goes off, leaving others alone', () => {
    expect(toggleScope(['issues:read', 'wiki:read'], 'issues', 'read', false)).toEqual([
      'wiki:read',
    ]);
  });
});
