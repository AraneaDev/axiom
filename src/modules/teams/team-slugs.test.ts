/**
 * Team slugs that an org-level route would shadow: /:org/settings is tried before /:org/:team, so a
 * team called settings would never reach its own overview.
 */
import { readFileSync } from 'fs';
import path from 'path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../../config/database';
import { cleanupTestContext, createTestContext, type TestContext } from '../../test/factory';
import { authGet, authPatch, authPost } from '../../test/helpers';
import { RESERVED_TEAM_SLUGS } from '../../utils/validation/common-validators';

const ROUTER_FILES = ['App.tsx', 'routes/admin-routes.tsx', 'routes/project-routes.tsx'].map(
  (file) => path.join(process.cwd(), 'frontend/src', file),
);

describe('reserved team slugs', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext('teamslugs');
  });

  afterAll(async () => {
    await cleanupTestContext(ctx);
  });

  it.each(['settings', 'approvals', 'analytics'])('refuses a new team called %s', async (slug) => {
    const res = await authPost(`/api/teams/org/${ctx.orgId}`, ctx.owner.token, {
      name: 'Taken',
      slug,
    });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/reserved/i);
    expect(await prisma.team.count({ where: { orgId: ctx.orgId, slug } })).toBe(0);
  });

  it('covers every org-level route the app has', () => {
    const source = ROUTER_FILES.map((file) => readFileSync(file, 'utf8')).join('\n');
    const segments = [
      ...new Set([...source.matchAll(/path="\/:org\/([a-z0-9-]+)/g)].map((m) => m[1])),
    ];
    expect(segments).toEqual(expect.arrayContaining(['settings', 'approvals', 'analytics']));
    expect(segments.filter((s) => !RESERVED_TEAM_SLUGS.has(s))).toEqual([]);
  });

  it('still takes a slug that only starts like one', async () => {
    const res = await authPost(`/api/teams/org/${ctx.orgId}`, ctx.owner.token, {
      name: 'Fine',
      slug: 'settings-team',
    });
    expect(res.status).toBe(201);
  });

  it('leaves a team that already has such a slug working, and a rename keeps it', async () => {
    const team = await prisma.team.create({
      data: {
        orgId: ctx.orgId,
        name: 'From before',
        slug: 'settings',
        members: { create: { userId: ctx.owner.id, role: 'ADMIN' } },
      },
    });
    expect((await authGet(`/api/teams/${team.id}`, ctx.owner.token)).status).toBe(200);
    const renamed = await authPatch(`/api/teams/${team.id}`, ctx.owner.token, { name: 'Renamed' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.slug).toBe('settings');
  });
});
