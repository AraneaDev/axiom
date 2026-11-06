/**
 * Token scopes per area. Stored tokens were rewritten from the four old scope names by a
 * migration, which maps each to the scopes of LEGACY_SCOPE_MAP. What a scope reaches is the
 * registry's to decide, pinned in src/actions/registry-rules.test.ts and token-reach.test.ts.
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
  SCOPE_AREAS,
  scopeAllows,
  INERT_SCOPES,
  MINTABLE_SCOPES,
  TOKEN_SCOPES,
} from './token-scopes';

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
    expect(SCOPE_AREAS).toHaveLength(15);
    expect(TOKEN_SCOPES).toHaveLength(30);
    for (const area of SCOPE_AREAS) {
      expect(TOKEN_SCOPES).toContain(`${area}:read`);
      expect(TOKEN_SCOPES).toContain(`${area}:write`);
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
      'github:read',
      'github:write',
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
