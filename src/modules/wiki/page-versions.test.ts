import bcrypt from 'bcryptjs';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { prisma } from '../../config/database';

import { createPageVersion, lockPage } from './page-versions';
import { getPageHistory, restoreVersion, updatePage } from './wiki.service';

describe('Page versions', () => {
  let userId: string;
  let spaceId: string;
  let pageId: string;
  const spaceSlug = 'pv-space';
  const pageSlug = 'pv-page';

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash('testpassword123', 4);
    const user = await prisma.user.upsert({
      where: { username: 'pv-test-user' },
      update: {},
      create: {
        email: 'pv-test@axiom.dev',
        username: 'pv-test-user',
        displayName: 'PV Test User',
        passwordHash,
      },
    });
    userId = user.id;
    const org = await prisma.organization.create({
      data: {
        name: 'PV Test Org',
        slug: 'pv-test-org',
        members: { create: { userId, role: 'OWNER' } },
      },
    });
    const team = await prisma.team.create({
      data: {
        name: 'PV Test Team',
        slug: 'pv-test-team',
        orgId: org.id,
        members: { create: { userId, role: 'ADMIN' } },
      },
    });
    const space = await prisma.wikiSpace.create({
      data: { teamId: team.id, name: 'PV Space', slug: spaceSlug },
    });
    spaceId = space.id;
    const page = await prisma.page.create({
      data: {
        spaceId,
        title: 'Title',
        slug: pageSlug,
        body: 'one',
        versions: { create: { version: 1, title: 'Title', body: 'one', authorId: userId } },
      },
    });
    pageId = page.id;
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { slug: 'pv-test-org' } });
    await prisma.user.deleteMany({ where: { username: 'pv-test-user' } });
    await prisma.$disconnect();
  });

  it('concurrent version creation never collides', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        prisma.$transaction((tx) =>
          createPageVersion(tx, {
            pageId,
            title: 'Title',
            body: `body ${i}`,
            authorId: userId,
            kind: 'EDIT',
          }),
        ),
      ),
    );
    const versions = results.map((v) => v.version).sort((a, b) => a - b);
    expect(versions).toEqual([2, 3, 4, 5, 6]);
    expect(new Set(versions).size).toBe(5);
  });

  it('retries after a unique violation and still succeeds', async () => {
    const before = await prisma.pageVersion.aggregate({
      where: { pageId },
      _max: { version: true },
    });
    const taken = before._max.version ?? 0;
    const created = await prisma.$transaction(async (tx) => {
      // Simulate a stale number computation: the first aggregate reports an already used number
      let calls = 0;
      const stale = new Proxy(tx, {
        get(target, prop, receiver) {
          if (prop === 'pageVersion') {
            return new Proxy(target.pageVersion, {
              get(m, name, r) {
                if (name === 'aggregate') {
                  return async (args: never) => {
                    calls++;
                    if (calls === 1) return { _max: { version: taken - 1 } };
                    return m.aggregate(args);
                  };
                }
                return Reflect.get(m, name, r) as unknown;
              },
            });
          }
          return Reflect.get(target, prop, receiver) as unknown;
        },
      }) as typeof tx;
      const v = await createPageVersion(stale, {
        pageId,
        title: 'Title',
        body: 'retry',
        authorId: userId,
        kind: 'EDIT',
      });
      expect(calls).toBe(2);
      return v;
    });
    expect(created.version).toBe(taken + 1);
  });

  it('deleting a page with a pending change succeeds', async () => {
    const page = await prisma.page.create({
      data: { spaceId, title: 'Doomed', slug: 'pv-doomed', body: 'x' },
    });
    const version = await prisma.$transaction((tx) =>
      createPageVersion(tx, {
        pageId: page.id,
        title: 'Doomed',
        body: 'ext',
        authorId: userId,
        kind: 'EXTERNAL',
      }),
    );
    await prisma.pendingPageChange.create({
      data: { pageId: page.id, baseBody: 'x', externalVersionId: version.id, authorId: userId },
    });
    await prisma.page.delete({ where: { id: page.id } });
    expect(await prisma.pendingPageChange.count({ where: { pageId: page.id } })).toBe(0);
    expect(await prisma.pageVersion.count({ where: { pageId: page.id } })).toBe(0);
  });

  it('updatePage decides on fresh data after taking the lock', async () => {
    const page = await prisma.page.findUniqueOrThrow({ where: { id: pageId } });
    // Hold the lock, change the body behind updatePage's back, then release it
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const lockedP = new Promise<void>((r) => (locked = r));
    const holder = prisma.$transaction(async (tx) => {
      await lockPage(tx, pageId);
      locked();
      await held;
      await tx.page.update({ where: { id: pageId }, data: { body: 'fresh' } });
    });
    await lockedP;
    // Request the stale body: after the holder commits, 'fresh' is current, so this IS a change
    const pending = updatePage(spaceId, pageSlug, userId, { body: page.body });
    await new Promise((r) => setTimeout(r, 200));
    release();
    await holder;
    const result = await pending;
    expect(result.body).toBe(page.body);
    // Stale data would have judged this a no-op and left 'fresh' in place
    expect(result.versions[0].body).toBe(page.body);
  });

  it('changeDescription alone creates no version and reports the real latest', async () => {
    const before = await prisma.pageVersion.findFirstOrThrow({
      where: { pageId },
      orderBy: { version: 'desc' },
    });
    const result = await updatePage(spaceId, pageSlug, userId, { changeDescription: 'note' });
    expect(result.versions[0].version).toBe(before.version);
    expect(result.versions[0].id).toBe(before.id);
  });

  it('restore records kind RESTORE', async () => {
    await restoreVersion(spaceId, pageSlug, 1, userId);
    const latest = await prisma.pageVersion.findFirstOrThrow({
      where: { pageId },
      orderBy: { version: 'desc' },
    });
    expect(latest.kind).toBe('RESTORE');
    expect(latest.changeDescription).toBe('Restored to version 1');
  });

  it('updatePage with identical title and body creates no version', async () => {
    const page = await prisma.page.findUniqueOrThrow({ where: { id: pageId } });
    const before = await prisma.pageVersion.count({ where: { pageId } });
    await updatePage(spaceId, pageSlug, userId, { title: page.title, body: page.body });
    expect(await prisma.pageVersion.count({ where: { pageId } })).toBe(before);

    await updatePage(spaceId, pageSlug, userId, { body: 'changed' });
    expect(await prisma.pageVersion.count({ where: { pageId } })).toBe(before + 1);
  });

  it('getPageHistory returns kind', async () => {
    const history = await getPageHistory(spaceId, pageSlug);
    expect(history.length).toBeGreaterThan(0);
    expect(history.every((v) => typeof v.kind === 'string')).toBe(true);
    expect(history.some((v) => v.kind === 'RESTORE')).toBe(true);
    expect(history.some((v) => v.kind === 'EDIT')).toBe(true);
  });
});
