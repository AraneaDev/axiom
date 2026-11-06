/**
 * The space list says which spaces the caller administers, so the UI shows the permissions panel
 * only to a space admin.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../../config/database';
import {
  addMemberToContext,
  cleanupTestContext,
  createTestContext,
  type TestContext,
  type TestUser,
} from '../../test/factory';
import { authGet } from '../../test/helpers';

describe('canManage on the space list', () => {
  let ctx: TestContext;
  let member: TestUser;
  let spaceId: string;

  beforeAll(async () => {
    ctx = await createTestContext(`spacemgr${Date.now()}`);
    member = await addMemberToContext(ctx);
    spaceId = (
      await prisma.wikiSpace.create({
        data: { teamId: ctx.teamId, name: 'Managed', slug: `managed-${Date.now()}` },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.spacePermission.deleteMany({ where: { spaceId } });
    await prisma.wikiSpace.deleteMany({ where: { teamId: ctx.teamId } });
    await prisma.user.deleteMany({ where: { id: member.id } });
    await cleanupTestContext(ctx);
  });

  const listed = async (user: TestUser) => {
    const res = await authGet(`/api/wiki/team/${ctx.teamId}/spaces`, user.token);
    expect(res.status).toBe(200);
    return (res.body as Array<{ id: string; canManage?: boolean }>).find((s) => s.id === spaceId);
  };

  it('is true for the org owner and false for a plain member', async () => {
    expect((await listed(ctx.owner))?.canManage).toBe(true);
    expect((await listed(member))?.canManage).toBe(false);
  });

  it('is true for a member who holds ADMIN on the space', async () => {
    await prisma.spacePermission.create({ data: { spaceId, userId: member.id, level: 'ADMIN' } });
    expect((await listed(member))?.canManage).toBe(true);
  });
});
