/**
 * Token path rules hold for every spelling Express routes to the same handler: trailing
 * slashes, case, doubled slashes and percent-encoding.
 */
import { describe, expect, it } from 'vitest';

import { normalizeApiPath, tokenAllows } from './token-scopes';

const variants = (path: string): string[] => {
  const parts = path.split('/');
  const upper = parts.map((p, i) => (i === parts.length - 1 ? p.toUpperCase() : p)).join('/');
  return [
    path,
    `${path}/`,
    `${path}//`,
    path.toUpperCase(),
    upper,
    path.replace('/api/', '/api//'),
    path.replace(/\/([a-z])/, (_, c: string) => `/%${c.charCodeAt(0).toString(16)}`),
  ];
};

const allows = (scopes: string[], method: string, raw: string) =>
  tokenAllows(scopes, method, normalizeApiPath(raw));

describe('normalizeApiPath', () => {
  it.each([
    ['/api/projects/a%2Fb', '/api/projects/a%2fb'],
    ['/api/projects/a%2fb', '/api/projects/a%2fb'],
    ['/api/projects/a%5Cb', '/api/projects/a%5cb'],
    ['/api/projects/a%2F', '/api/projects/a%2f'],
  ])('keeps an encoded slash or backslash inside its segment: %s', (raw, normal) => {
    expect(normalizeApiPath(raw)).toBe(normal);
  });

  it('still decodes everything else', () => {
    expect(normalizeApiPath('/api/%70rojects/a%20b')).toBe('/api/projects/a b');
    expect(normalizeApiPath('/api/projects/a%252Fb')).toBe('/api/projects/a%2fb');
  });

  it('reads a project id with an encoded slash as a project, not as a subpath', () => {
    expect(allows(['issues:write'], 'PATCH', '/api/projects/a%2Fb')).toBe(false);
    expect(allows(['issues:write'], 'DELETE', '/api/projects/a%5Cb')).toBe(false);
    expect(allows(['issues:write'], 'PATCH', '/api/projects/a/b')).toBe(true);
  });

  it('keeps legitimate escaped ids reachable', () => {
    expect(allows(['wiki:read'], 'GET', '/api/wiki/pages/a%20b')).toBe(true);
    expect(allows(['issues:write'], 'PATCH', '/api/projects/p%31/issues/1')).toBe(true);
  });
});

describe('token path rules across spellings', () => {
  const blocked: Array<[string, string, string[]]> = [
    ['DELETE', '/api/projects/abc', ['issues:write']],
    ['PATCH', '/api/projects/abc', ['issues:write']],
    ['POST', '/api/projects/team/t1', ['issues:write']],
    ['PUT', '/api/wiki/spaces/s1/permissions', ['wiki:write']],
    ['DELETE', '/api/wiki/spaces/s1/permissions/p1', ['wiki:write']],
    ['PUT', '/api/wiki/pages/p1/restrictions', ['wiki:write']],
    ['DELETE', '/api/wiki/restrictions/r1', ['wiki:write']],
    ['POST', '/api/users/me/tokens', ['issues:write', 'wiki:write']],
    ['GET', '/api/admin/users', ['issues:write', 'wiki:write']],
    ['PATCH', '/api/orgs/o1', ['issues:write', 'wiki:write']],
  ];
  for (const [method, path, scopes] of blocked) {
    it(`refuses ${method} ${path} in every spelling`, () => {
      for (const v of variants(path)) expect(allows(scopes, method, v), v).toBe(false);
    });
  }

  const scoped: Array<[string, string, string[], string[]]> = [
    // method, path, a scope that must be refused, a scope that must pass
    ['GET', '/api/projects/p1/issues', ['wiki:read'], ['issues:read']],
    ['POST', '/api/projects/p1/issues', ['issues:read'], ['issues:write']],
    ['GET', '/api/wiki/spaces/s1/tree', ['issues:read'], ['wiki:read']],
    ['POST', '/api/wiki/spaces/s1/pages', ['wiki:read'], ['wiki:write']],
    ['GET', '/api/teams/t1/activity', ['wiki:read'], ['issues:read']],
    ['GET', '/api/teams/t1/roadmap/timeline', ['wiki:read'], ['issues:read']],
    ['GET', '/api/teams/t1/members/profile/bob', ['wiki:read'], ['issues:read']],
    ['GET', '/api/users/me/dashboard', ['wiki:read'], ['issues:read']],
    ['GET', '/api/issues/i1/approval-requests', ['wiki:read'], ['issues:read']],
  ];
  for (const [method, path, refused, allowed] of scoped) {
    it(`scopes ${method} ${path} in every spelling`, () => {
      for (const v of variants(path)) {
        expect(allows(refused, method, v), `${v} with ${refused}`).toBe(false);
        expect(allows(allowed, method, v), `${v} with ${allowed}`).toBe(true);
      }
    });
  }
});
