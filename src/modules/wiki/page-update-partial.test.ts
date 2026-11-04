/**
 * PATCH on a page changes the fields sent and keeps the rest. parentId is the odd one: null
 * moves the page to the top level, and leaving it out keeps the parent.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../../config/database';
import { cleanupTestContext, createTestContext, type TestContext } from '../../test/factory';
import { authPatch } from '../../test/helpers';

describe('Partial page updates', () => {
  let ctx: TestContext;
  let spaceId: string;
  let parentId: string;

  const makePage = (slug: string, data: { parentId?: string; isDraft?: boolean } = {}) =>
    prisma.page.create({
      data: { spaceId, title: `T ${slug}`, slug, body: `body of ${slug}`, ...data },
    });

  beforeAll(async () => {
    ctx = await createTestContext(`pageupd${Date.now()}`);
    const space = await prisma.wikiSpace.create({
      data: { teamId: ctx.teamId, name: 'Upd', slug: 'upd' },
    });
    spaceId = space.id;
    parentId = (await makePage('parent')).id;
  });

  afterAll(async () => {
    await cleanupTestContext(ctx);
  });

  const patch = (slug: string, body: object) =>
    authPatch(`/api/wiki/spaces/${spaceId}/pages/${slug}`, ctx.owner.token, body);

  it('a title-only update keeps the body and the draft state', async () => {
    await makePage('title-only', { isDraft: true });
    const res = await patch('title-only', { title: 'Renamed' });
    expect(res.status).toBe(200);
    const page = await prisma.page.findUniqueOrThrow({
      where: { spaceId_slug: { spaceId, slug: 'title-only' } },
    });
    expect(page.title).toBe('Renamed');
    expect(page.body).toBe('body of title-only');
    expect(page.isDraft).toBe(true);
  });

  it('a title and a null parent keep the body', async () => {
    await makePage('null-parent');
    const res = await patch('null-parent', { title: 'Again', parentId: null });
    expect(res.status).toBe(200);
    const page = await prisma.page.findUniqueOrThrow({
      where: { spaceId_slug: { spaceId, slug: 'null-parent' } },
    });
    expect(page.title).toBe('Again');
    expect(page.body).toBe('body of null-parent');
  });

  it('a null parent moves a page that has a parent to the top level', async () => {
    await makePage('child-a', { parentId });
    const res = await patch('child-a', { parentId: null });
    expect(res.status).toBe(200);
    const page = await prisma.page.findUniqueOrThrow({
      where: { spaceId_slug: { spaceId, slug: 'child-a' } },
    });
    expect(page.parentId).toBeNull();
  });

  it('a save that leaves parentId out keeps the parent', async () => {
    await makePage('child-b', { parentId });
    const res = await patch('child-b', { title: 'Same place', body: 'new body' });
    expect(res.status).toBe(200);
    const page = await prisma.page.findUniqueOrThrow({
      where: { spaceId_slug: { spaceId, slug: 'child-b' } },
    });
    expect(page.parentId).toBe(parentId);
    expect(page.body).toBe('new body');
  });
});
