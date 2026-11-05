import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../../config/database';
import { cleanupTestContext, createTestContext, type TestContext } from '../../test/factory';
import { authDel, authPatch, authPost } from '../../test/helpers';

describe('an org or team id that is no record', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext(`abs${Date.now()}`);
    // A platform admin passes the permission check on any id, so the service meets the absent one
    await prisma.user.update({ where: { id: ctx.owner.id }, data: { isAdmin: true } });
  });

  afterAll(async () => {
    await cleanupTestContext(ctx);
  });

  const absent = ['nosuch', 'cabsentabsentabsentabsent0'];
  const calls = (id: string): Array<[string, () => Promise<{ status: number }>]> => [
    [`PATCH /api/orgs/${id}`, () => authPatch(`/api/orgs/${id}`, ctx.owner.token, { name: 'X' })],
    [`DELETE /api/orgs/${id}`, () => authDel(`/api/orgs/${id}`, ctx.owner.token)],
    [
      `POST /api/orgs/${id}/members`,
      () => authPost(`/api/orgs/${id}/members`, ctx.owner.token, { userId: ctx.owner.id }),
    ],
    [
      `PATCH /api/orgs/${id}/members/x`,
      () => authPatch(`/api/orgs/${id}/members/x`, ctx.owner.token, { role: 'ADMIN' }),
    ],
    [
      `DELETE /api/orgs/${id}/members/x`,
      () => authDel(`/api/orgs/${id}/members/x`, ctx.owner.token),
    ],
    [
      `POST /api/orgs/${id}/invitations`,
      () =>
        authPost(`/api/orgs/${id}/invitations`, ctx.owner.token, {
          email: 'nobody@example.test',
          role: 'MEMBER',
        }),
    ],
    [
      `POST /api/orgs/${id}/teams`,
      () => authPost(`/api/orgs/${id}/teams`, ctx.owner.token, { name: 'X', slug: 'x-team' }),
    ],
    [`PATCH /api/teams/${id}`, () => authPatch(`/api/teams/${id}`, ctx.owner.token, { name: 'X' })],
    [`DELETE /api/teams/${id}`, () => authDel(`/api/teams/${id}`, ctx.owner.token)],
    [
      `POST /api/teams/${id}/members`,
      () => authPost(`/api/teams/${id}/members`, ctx.owner.token, { userId: ctx.owner.id }),
    ],
    [
      `PATCH /api/teams/${id}/members/x`,
      () => authPatch(`/api/teams/${id}/members/x`, ctx.owner.token, { role: 'ADMIN' }),
    ],
    [
      `DELETE /api/teams/${id}/members/x`,
      () => authDel(`/api/teams/${id}/members/x`, ctx.owner.token),
    ],
  ];

  it.each(absent)('answers a platform admin session 404 and never 500 (%s)', async (id) => {
    for (const [name, call] of calls(id)) {
      const res = await call();
      expect(res.status, name).toBe(404);
    }
  });
});
