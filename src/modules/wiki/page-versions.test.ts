import bcrypt from 'bcryptjs';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { prisma } from '../../config/database';

import { createPageVersion } from './page-versions';
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
