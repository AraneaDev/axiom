/**
 * Token scopes per area. Stored tokens were rewritten from the four old scope names, and
 * each must reach exactly what it reached under the old path rules, no more and no less.
 */
import crypto from 'crypto';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../config/database';
import { createApiToken } from '../modules/users/users.service';
import { cleanupTestContext, createTestContext, type TestContext } from '../test/factory';
import { authPost } from '../test/helpers';

import {
  LEGACY_SCOPE_MAP,
  normalizeApiPath,
  SCOPE_AREAS,
  scopeAllows,
  INERT_SCOPES,
  MINTABLE_SCOPES,
  TOKEN_SCOPES,
  tokenAllows,
} from './token-scopes';

// ─── Frozen copy of the path rules before scopes per area. Do not update. ───

const OLD_SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);
const OLD_ACCESS_CONTROL = [
  /^\/api\/wiki\/spaces\/[^/]+\/permissions(\/|$)/,
  /^\/api\/wiki\/pages\/[^/]+\/restrictions$/,
  /^\/api\/wiki\/restrictions\//,
  /^\/api\/projects\/team\/[^/]+$/,
  /^\/api\/projects\/[^/]+$/,
];
function oldHas(scopes: readonly string[], area: 'issues' | 'wiki', write: boolean): boolean {
  return write
    ? scopes.includes(`${area}:write`)
    : scopes.includes(`${area}:read`) || scopes.includes(`${area}:write`);
}
function oldAreaOf(path: string): 'issues' | 'wiki' | 'any' | 'none' {
  if (path.startsWith('/api/wiki')) return 'wiki';
  if (
    path.startsWith('/api/projects') ||
    path.startsWith('/api/issues') ||
    path.startsWith('/api/approval-requests') ||
    path.startsWith('/api/custom-fields') ||
    path.startsWith('/api/links') ||
    /^\/api\/teams\/[^/]+\/(roadmap\/timeline|analytics|activity)$/.test(path) ||
    /^\/api\/teams\/[^/]+\/members\/profile\/[^/]+$/.test(path) ||
    path === '/api/users/me/dashboard'
  ) {
    return 'issues';
  }
  if (path.startsWith('/api/attachments')) return 'any';
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
function oldTokenAllows(scopes: readonly string[], method: string, path: string): boolean {
  const write = !OLD_SAFE.has(method);
  if (path.startsWith('/api/admin')) return false;
  if (path.startsWith('/api/users/me') && write) return false;
  if (write && OLD_ACCESS_CONTROL.some((re) => re.test(path))) return false;
  const area = oldAreaOf(path);
  if (area === 'issues' || area === 'wiki') return oldHas(scopes, area, write);
  if (area === 'any') {
    if (path.startsWith('/api/attachments')) {
      return write
        ? oldHas(scopes, 'issues', true) || oldHas(scopes, 'wiki', true)
        : oldHas(scopes, 'issues', false) || oldHas(scopes, 'wiki', false);
    }
    if (write && !path.startsWith('/api/notifications')) return false;
    return oldHas(scopes, 'issues', false) || oldHas(scopes, 'wiki', false);
  }
  return false;
}

// ─── Samples ────────────────────────────────────────────────

const METHODS = ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE'];

/** The (method, path) samples of token-scopes-paths.test.ts */
const PATH_FIXTURES: Array<[string, string]> = [
  ['DELETE', '/api/projects/abc'],
  ['PATCH', '/api/projects/abc'],
  ['POST', '/api/projects/team/t1'],
  ['PUT', '/api/wiki/spaces/s1/permissions'],
  ['DELETE', '/api/wiki/spaces/s1/permissions/p1'],
  ['PUT', '/api/wiki/pages/p1/restrictions'],
  ['DELETE', '/api/wiki/restrictions/r1'],
  ['POST', '/api/users/me/tokens'],
  ['GET', '/api/admin/users'],
  ['PATCH', '/api/orgs/o1'],
  ['GET', '/api/projects/p1/issues'],
  ['POST', '/api/projects/p1/issues'],
  ['GET', '/api/wiki/spaces/s1/tree'],
  ['POST', '/api/wiki/spaces/s1/pages'],
  ['GET', '/api/teams/t1/activity'],
  ['GET', '/api/teams/t1/roadmap/timeline'],
  ['GET', '/api/teams/t1/members/profile/bob'],
  ['GET', '/api/users/me/dashboard'],
  ['GET', '/api/issues/i1/approval-requests'],
];

/** One path per mounted route family, tried with every method */
const ROUTE_PATHS = [
  '/api/projects',
  '/api/projects/p1',
  '/api/projects/team/t1',
  '/api/projects/team/t1/extra',
  '/api/projects/p1/analytics',
  '/api/projects/p1/issues',
  '/api/projects/p1/issues/1',
  '/api/projects/p1/issues/bulk',
  '/api/projects/p1/issues/1/comments',
  '/api/projects/p1/comments/c1',
  '/api/projects/p1/activity',
  '/api/projects/p1/time-report',
  '/api/projects/p1/sprints',
  '/api/projects/p1/sprints/s1/start',
  '/api/projects/p1/velocity',
  '/api/projects/p1/backlog',
  '/api/projects/p1/board',
  '/api/projects/p1/board/columns/c1',
  '/api/projects/p1/forms',
  '/api/projects/p1/forms/f1',
  '/api/projects/p1/intake',
  '/api/projects/p1/intake/s1',
  '/api/projects/p1/automation-rules',
  '/api/projects/p1/automation-rules/r1/toggle',
  '/api/projects/p1/approval-gates',
  '/api/projects/p1/workflow-rules/r1',
  '/api/projects/p1/custom-fields',
  '/api/projects/p1/labels/bug',
  '/api/projects/p1/issue-templates/t1',
  '/api/projects/p1/milestones',
  '/api/projects/p1/roadmap/buckets',
  '/api/projects/p1/constructor',
  '/api/projectsx/p1',
  '/api/issues/i1/custom-fields',
  '/api/issues/i1/approval-requests',
  '/api/approval-requests/r1/vote',
  '/api/custom-fields/f1',
  '/api/links/resolve-link',
  '/api/wiki/team/t1/spaces',
  '/api/wiki/spaces/s1',
  '/api/wiki/spaces/s1/tree',
  '/api/wiki/spaces/s1/permissions',
  '/api/wiki/spaces/s1/permissions/p1',
  '/api/wiki/pages/p1',
  '/api/wiki/pages/p1/restrictions',
  '/api/wiki/pages/p1/comments',
  '/api/wiki/restrictions/r1',
  '/api/wiki/resolve-template',
  '/api/attachments',
  '/api/attachments/a1',
  '/api/attachments/a1/meta',
  '/api/search',
  '/api/search/spaces',
  '/api/search/saved',
  '/api/search/saved/s1',
  '/api/orgs',
  '/api/orgs/o1',
  '/api/orgs/o1/members',
  '/api/teams/org/o1',
  '/api/teams/t1',
  '/api/teams/t1/members',
  '/api/teams/t1/activity',
  '/api/teams/t1/analytics',
  '/api/teams/t1/roadmap/timeline',
  '/api/teams/t1/members/profile/bob',
  '/api/teams/roadmap',
  '/api/users/me',
  '/api/users/me/dashboard',
  '/api/users/me/tokens',
  '/api/users/me/tokens/t1',
  '/api/users/me/pending-approvals',
  '/api/users/search',
  '/api/users/u1',
  '/api/notifications',
  '/api/notifications/unread-count',
  '/api/notifications/n1/read',
  '/api/notifications/read-all',
  '/api/notifications/preferences',
  '/api/admin',
  '/api/admin/users',
  '/api/admin/audit-logs',
  '/api/saved-filters',
  '/api/saved-filters/f1',
  '/api/invitations/abc/accept',
  '/api/auth/2fa/enable',
  '/api/site-settings',
  '/api/nothing-here',
];

const SAMPLES: Array<[string, string]> = [
  ...PATH_FIXTURES,
  ...ROUTE_PATHS.flatMap((path) => METHODS.map((m): [string, string] => [m, path])),
];

const LEGACY = ['issues:read', 'issues:write', 'wiki:read', 'wiki:write'] as const;

/**
 * Run the migration verbatim on a stored token, then roll everything back.
 * @param stored - The scopes the token holds before the migration
 * @param userId - The token owner
 */
async function migratedScopes(stored: string[], userId: string): Promise<string[] | null> {
  const dir = readdirSync(join(process.cwd(), 'prisma', 'migrations')).find((d) =>
    d.endsWith('_token_scope_areas'),
  );
  if (!dir) throw new Error('token_scope_areas migration not found');
  const sql = readFileSync(
    join(process.cwd(), 'prisma', 'migrations', dir, 'migration.sql'),
    'utf8',
  );
  const rollback = new Error('rollback');
  let result: string[] | null = null;
  await prisma
    .$transaction(async (tx) => {
      const raw = `tk_${crypto.randomBytes(24).toString('hex')}`;
      const row = await tx.apiToken.create({
        data: {
          userId,
          name: 'migration',
          tokenHash: crypto.createHash('sha256').update(raw).digest('hex'),
          prefix: raw.slice(0, 11),
          scopes: stored,
        },
      });
      await tx.$executeRawUnsafe(sql);
      result = (await tx.apiToken.findUniqueOrThrow({ where: { id: row.id } })).scopes;
      throw rollback;
    })
    .catch((err: unknown) => {
      if (err !== rollback) throw err;
    });
  return result;
}

describe('token scopes per area', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext(`scopeareas${Date.now()}`);
  });

  afterAll(async () => {
    await cleanupTestContext(ctx);
  });

  it('has one read and one write scope per area', () => {
    expect(SCOPE_AREAS).toHaveLength(14);
    expect(TOKEN_SCOPES).toHaveLength(28);
    for (const area of SCOPE_AREAS) {
      expect(TOKEN_SCOPES).toContain(`${area}:read`);
      expect(TOKEN_SCOPES).toContain(`${area}:write`);
    }
  });

  it('maps every legacy scope so it reaches exactly the same REST paths', () => {
    for (const legacy of LEGACY) {
      for (const [method, path] of SAMPLES) {
        expect(
          tokenAllows(LEGACY_SCOPE_MAP[legacy], method, path),
          `${legacy} ${method} ${path}`,
        ).toBe(oldTokenAllows([legacy], method, path));
      }
    }
  });

  it('keeps the reach of a token that held several legacy scopes', () => {
    for (let bits = 1; bits < 2 ** LEGACY.length; bits++) {
      const held = LEGACY.filter((_, i) => bits & (1 << i));
      const mapped = held.flatMap((legacy) => LEGACY_SCOPE_MAP[legacy]);
      for (const [method, path] of SAMPLES) {
        expect(tokenAllows(mapped, method, path), `${held.join()} ${method} ${path}`).toBe(
          oldTokenAllows(held, method, path),
        );
      }
    }
  });

  it('holds the same reach for the spellings Express routes alike', () => {
    for (const legacy of LEGACY) {
      for (const [method, path] of SAMPLES) {
        for (const raw of [`${path}/`, path.toUpperCase(), path.replace('/api/', '/api//')]) {
          const normal = normalizeApiPath(raw);
          expect(
            tokenAllows(LEGACY_SCOPE_MAP[legacy], method, normal),
            `${legacy} ${method} ${raw}`,
          ).toBe(oldTokenAllows([legacy], method, normal));
        }
      }
    }
  });

  it('gives legacy tokens no write scope in an area they could never write', () => {
    const everything = Object.values(LEGACY_SCOPE_MAP).flat();
    for (const never of [
      'projects:write',
      'orgs:write',
      'teams:write',
      'search:write',
      'dashboards:write',
      'admin:read',
      'admin:write',
    ] as const) {
      expect(everything).not.toContain(never);
    }
    // Read tokens hold no write scope at all
    for (const legacy of ['issues:read', 'wiki:read'] as const) {
      expect(LEGACY_SCOPE_MAP[legacy].filter((s) => s.endsWith(':write'))).toEqual([]);
    }
    // A wiki token gets nothing from the issue side
    for (const legacy of ['wiki:read', 'wiki:write'] as const) {
      for (const area of [
        'issues',
        'sprints',
        'boards',
        'projects',
        'dashboards',
        'forms',
        'automation',
        'approvals',
      ] as const) {
        expect(scopeAllows(LEGACY_SCOPE_MAP[legacy], area, 'read'), `${legacy} ${area}`).toBe(
          false,
        );
      }
    }
  });

  it('never allows the always-blocked requests, whatever the scopes', () => {
    const blocked: Array<[string, string]> = [
      ['GET', '/api/admin/users'],
      ['POST', '/api/admin/users/u1/deactivate'],
      ['PATCH', '/api/users/me'],
      ['POST', '/api/users/me/tokens'],
      ['DELETE', '/api/users/me/tokens/t1'],
      ['PUT', '/api/wiki/spaces/s1/permissions'],
      ['DELETE', '/api/wiki/spaces/s1/permissions/p1'],
      ['PUT', '/api/wiki/pages/p1/restrictions'],
      ['DELETE', '/api/wiki/restrictions/r1'],
      ['POST', '/api/projects/team/t1'],
      ['PATCH', '/api/projects/p1'],
      ['DELETE', '/api/projects/p1'],
      ['POST', '/api/orgs'],
      ['PATCH', '/api/orgs/o1'],
      ['POST', '/api/teams/org/o1'],
      ['PATCH', '/api/teams/t1'],
      ['DELETE', '/api/teams/t1'],
      ['POST', '/api/search/saved'],
      ['GET', '/api/saved-filters'],
      ['POST', '/api/invitations/abc/accept'],
    ];
    for (const [method, path] of blocked) {
      expect(tokenAllows(TOKEN_SCOPES, method, path), `${method} ${path}`).toBe(false);
    }
  });

  it('requires the scope of the area a path belongs to', () => {
    const cases: Array<[string, string, string]> = [
      ['GET', '/api/projects/p1/sprints', 'sprints:read'],
      ['POST', '/api/projects/p1/sprints', 'sprints:write'],
      ['GET', '/api/projects/p1/board', 'boards:read'],
      ['PATCH', '/api/projects/p1/board/columns/c1', 'boards:write'],
      ['GET', '/api/projects/p1/forms', 'forms:read'],
      ['GET', '/api/projects/p1/automation-rules', 'automation:read'],
      ['POST', '/api/projects/p1/approval-gates', 'approvals:write'],
      ['POST', '/api/approval-requests/r1/vote', 'approvals:write'],
      ['GET', '/api/projects/p1', 'projects:read'],
      ['GET', '/api/projects/team/t1', 'projects:read'],
      ['GET', '/api/attachments/a1', 'files:read'],
      ['POST', '/api/attachments', 'files:write'],
      ['GET', '/api/search', 'search:read'],
      ['GET', '/api/orgs/o1', 'orgs:read'],
      ['GET', '/api/teams/t1', 'teams:read'],
      ['GET', '/api/users/me/dashboard', 'dashboards:read'],
    ];
    for (const [method, path, scope] of cases) {
      expect(tokenAllows([scope], method, path), `${scope} ${method} ${path}`).toBe(true);
      const others = TOKEN_SCOPES.filter(
        (s) =>
          s.split(':')[0] !== scope.split(':')[0] &&
          // These two read the same data the dashboard is made of
          !(path === '/api/users/me/dashboard' && s.startsWith('issues:')),
      );
      expect(tokenAllows(others, method, path), `others ${method} ${path}`).toBe(false);
    }
  });

  it('write implies read within an area only', () => {
    expect(scopeAllows(['wiki:write'], 'wiki', 'read')).toBe(true);
    expect(scopeAllows(['wiki:write'], 'wiki', 'write')).toBe(true);
    expect(scopeAllows(['wiki:read'], 'wiki', 'read')).toBe(true);
    expect(scopeAllows(['wiki:read'], 'wiki', 'write')).toBe(false);
    expect(scopeAllows(['wiki:write'], 'issues', 'read')).toBe(false);
    expect(scopeAllows([], 'wiki', 'read')).toBe(false);
  });

  it('migrates stored tokens', async () => {
    for (const legacy of LEGACY) {
      const scopes = await migratedScopes([legacy], ctx.owner.id);
      expect([...(scopes ?? [])].sort()).toEqual([...LEGACY_SCOPE_MAP[legacy]].sort());
    }
  });

  it('merges several legacy scopes and drops what was never a working scope', async () => {
    const merged = await migratedScopes(['issues:read', 'wiki:write'], ctx.owner.id);
    expect([...(merged ?? [])].sort()).toEqual(
      [...new Set([...LEGACY_SCOPE_MAP['issues:read'], ...LEGACY_SCOPE_MAP['wiki:write']])].sort(),
    );
    // Inert before the migration, and live scope names now: they must not wake up
    expect(await migratedScopes(['projects:write', 'admin:read', 'junk'], ctx.owner.id)).toEqual(
      [],
    );
    expect(await migratedScopes([], ctx.owner.id)).toEqual([]);
  });

  it('refuses unknown scope names on create', async () => {
    const res = await authPost('/api/users/me/tokens', ctx.owner.token, {
      name: 'bad',
      scopes: ['issues:admin'],
    });
    expect(res.status).toBe(400);
  });

  it('accepts every mintable scope on create', async () => {
    const res = await authPost('/api/users/me/tokens', ctx.owner.token, {
      name: 'all',
      scopes: [...MINTABLE_SCOPES],
    });
    expect(res.status).toBe(201);
    expect(res.body.scopes).toEqual([...MINTABLE_SCOPES]);
  });

  it.each(INERT_SCOPES)('refuses the inert scope %s on create', async (scope) => {
    const res = await authPost('/api/users/me/tokens', ctx.owner.token, {
      name: 'inert',
      scopes: ['issues:read', scope],
    });
    expect(res.status).toBe(400);
    const stored = await prisma.apiToken.count({ where: { name: 'inert' } });
    expect(stored).toBe(0);
  });

  it('refuses an inert scope in the service too, not only in the request schema', async () => {
    await expect(
      createApiToken(ctx.owner.id, { name: 'inert', scopes: ['orgs:write'] }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});
