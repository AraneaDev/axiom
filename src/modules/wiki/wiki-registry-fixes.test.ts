/**
 * Behaviour of the migrated page routes that the first migration left unguarded: pending merges
 * over REST, a body that is missing, empty ids, and the tree after a move inside a space.
 */
import request from 'supertest';
import { afterAll, beforeAll, afterEach, describe, expect, it } from 'vitest';

import { prisma } from '../../config/database';
import app from '../../index';
import { setRoomLiveCheck } from '../../realtime/room-registry';
import {
  addMemberToContext,
  cleanupTestContext,
  createTestContext,
  createTestUser,
  type TestContext,
  type TestUser,
} from '../../test/factory';
import { authGet, authPatch, authPost } from '../../test/helpers';

describe('Wiki routes behind the registry', () => {
  let ctx: TestContext;
  let stranger: TestUser;
  let member: TestUser;
  let spaceId: string;
  let parentId: string;
  const pageIds: Record<string, string> = {};

  const makePage = async (slug: string, parent?: string) => {
    const page = await prisma.page.create({
      data: { spaceId, title: slug, slug, body: `body ${slug}`, parentId: parent },
    });
    pageIds[slug] = page.id;
    return page;
  };

  beforeAll(async () => {
    ctx = await createTestContext(`wikifix${Date.now()}`);
    stranger = await createTestUser();
    member = await addMemberToContext(ctx);
    const space = await prisma.wikiSpace.create({
      data: { teamId: ctx.teamId, name: 'Fix', slug: 'fix' },
    });
    spaceId = space.id;
    parentId = (await makePage('parent')).id;
  });

  afterEach(() => setRoomLiveCheck(() => false));

  afterAll(async () => {
    await cleanupTestContext(ctx);
  });

  it('a body change over REST while a session is live reports pendingMerge', async () => {
    const page = await makePage('live');
    setRoomLiveCheck((id) => id === page.id);
    const res = await authPatch(`/api/wiki/spaces/${spaceId}/pages/live`, ctx.owner.token, {
      body: 'changed from outside',
    });
    expect(res.status).toBe(200);
    expect(res.body.pendingMerge).toBe(true);
    const pending = await authGet(
      `/api/wiki/spaces/${spaceId}/pages/live/pending-merge`,
      ctx.owner.token,
    );
    expect(pending.status).toBe(200);
    expect(pending.body).not.toBeNull();
  });

  it('a write route without a body is a 400, and a refused caller still gets 403', async () => {
    await makePage('nobody');
    const noBody = (path: string, token: string, method: 'post' | 'patch') => {
      const req = request(app)[method](path);
      return req.set('Authorization', `Bearer ${token}`).set('X-Requested-With', 'XMLHttpRequest');
    };
    const copy = `/api/wiki/pages/${pageIds.nobody}/copy`;
    expect((await noBody(copy, ctx.owner.token, 'post')).status).toBe(400);
    expect((await noBody(copy, stranger.token, 'post')).status).toBe(403);
    const update = `/api/wiki/spaces/${spaceId}/pages/nobody`;
    expect((await noBody(update, ctx.owner.token, 'patch')).status).toBe(400);
    const array = await request(app)
      .patch(update)
      .set('Authorization', `Bearer ${ctx.owner.token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send([{ title: 'x' }]);
    expect(array.status).toBe(400);
    const stored = await prisma.page.findUniqueOrThrow({ where: { id: pageIds.nobody } });
    expect(stored.title).toBe('nobody');
  });

  it('an empty parent id is a 400, not a foreign key failure', async () => {
    await makePage('empty-ids');
    const id = pageIds['empty-ids'];
    const t = ctx.owner.token;
    expect(
      (await authPatch(`/api/wiki/spaces/${spaceId}/pages/empty-ids`, t, { parentId: '' })).status,
    ).toBe(400);
    expect(
      (
        await authPost(`/api/wiki/spaces/${spaceId}/pages`, t, {
          title: 'X',
          slug: 'x',
          parentId: '',
        })
      ).status,
    ).toBe(400);
    expect((await authPost(`/api/wiki/pages/${id}/move`, t, { targetParentId: '' })).status).toBe(
      400,
    );
    expect(
      (await authPatch(`/api/wiki/pages/${id}/reorder`, t, { parentId: '', position: 0 })).status,
    ).toBe(400);
  });

  it('moving a page inside its space shows in the tree at once', async () => {
    await makePage('mover');
    const t = ctx.owner.token;
    const before = await authGet(`/api/wiki/spaces/${spaceId}/tree`, t);
    expect(before.body.some((n: { slug: string }) => n.slug === 'mover')).toBe(true);
    const moved = await authPost(`/api/wiki/pages/${pageIds.mover}/move`, t, {
      targetParentId: parentId,
    });
    expect(moved.status).toBe(200);
    const after = await authGet(`/api/wiki/spaces/${spaceId}/tree`, t);
    expect(after.body.some((n: { slug: string }) => n.slug === 'mover')).toBe(false);
    const parent = after.body.find((n: { slug: string }) => n.slug === 'parent');
    expect(parent.children.some((n: { slug: string }) => n.slug === 'mover')).toBe(true);
    expect(member.id).toBeTruthy();
  });
});
