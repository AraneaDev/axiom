import bcrypt from 'bcryptjs';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import { prisma } from '../../config/database';
import { normalizeMarkdown } from '../../lib/editor-core';

import {
  registerExternalChangeHook,
  resetExternalChangeHooksForTest,
  writePageBody,
} from './page-writes';
import { createPage, restoreVersion } from './wiki.service';

describe('writePageBody', () => {
  let userId: string;
  let spaceId: string;
  let pageId: string;
  const live = { isRoomLive: () => true };
  const notLive = { isRoomLive: () => false };

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash('testpassword123', 4);
    const user = await prisma.user.upsert({
      where: { username: 'pw-test-user' },
      update: {},
      create: {
        email: 'pw-test@axiom.dev',
        username: 'pw-test-user',
        displayName: 'PW Test User',
        passwordHash,
      },
    });
    userId = user.id;
    const org = await prisma.organization.create({
      data: {
        name: 'PW Test Org',
        slug: 'pw-test-org',
        members: { create: { userId, role: 'OWNER' } },
      },
    });
    const team = await prisma.team.create({
      data: {
        name: 'PW Test Team',
        slug: 'pw-test-team',
        orgId: org.id,
        members: { create: { userId, role: 'ADMIN' } },
      },
    });
    const space = await prisma.wikiSpace.create({
      data: { teamId: team.id, name: 'PW Space', slug: 'pw-space' },
    });
    spaceId = space.id;
  });

  beforeEach(async () => {
    resetExternalChangeHooksForTest();
    await prisma.page.deleteMany({ where: { spaceId } });
    const page = await prisma.page.create({
      data: { spaceId, title: 'Start', slug: 'pw-page', body: 'Original body' },
    });
    pageId = page.id;
    await prisma.pageVersion.create({
      data: { pageId, version: 1, title: 'Start', body: 'Original body', authorId: userId },
    });
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { slug: 'pw-test-org' } });
    await prisma.user.deleteMany({ where: { username: 'pw-test-user' } });
    await prisma.$disconnect();
  });

  const write = (
    body: string | undefined,
    deps: { isRoomLive: () => boolean },
    extra: Partial<Parameters<typeof writePageBody>[0]> = {},
  ) =>
    writePageBody(
      { pageId, authorId: userId, body, kind: 'EXTERNAL', source: 'mcp', ...extra },
      deps,
    );

  it('external write with no live room replaces body', async () => {
    const result = await write('New body', notLive);
    expect(result.pendingMerge).toBe(false);
    expect(result.version?.kind).toBe('EXTERNAL');
    const page = await prisma.page.findUniqueOrThrow({ where: { id: pageId } });
    expect(page.body).toBe('New body');
    expect(await prisma.pendingPageChange.count({ where: { pageId } })).toBe(0);
  });

  it('external write with a live room records a pending change and keeps Page.body', async () => {
    const notified: string[] = [];
    registerExternalChangeHook((id) => notified.push(id));
    const result = await write('Changed outside', live);
    expect(result.pendingMerge).toBe(true);
    const page = await prisma.page.findUniqueOrThrow({ where: { id: pageId } });
    expect(page.body).toBe('Original body');
    const pending = await prisma.pendingPageChange.findUniqueOrThrow({ where: { pageId } });
    expect(pending.baseBody).toBe('Original body');
    expect(pending.externalVersionId).toBe(result.version!.id);
    expect(notified).toContain(pageId);
  });

  it('second external write keeps the original baseBody and updates externalVersionId', async () => {
    await write('First change', live);
    const second = await write('Second change', live);
    const pending = await prisma.pendingPageChange.findUniqueOrThrow({ where: { pageId } });
    expect(pending.baseBody).toBe('Original body');
    expect(pending.externalVersionId).toBe(second.version!.id);
    expect(await prisma.pendingPageChange.count({ where: { pageId } })).toBe(1);
  });

  it('editor-session source never creates a pending change', async () => {
    const result = await write('Typed in editor', live, { source: 'editor-session', kind: 'EDIT' });
    expect(result.pendingMerge).toBe(false);
    const page = await prisma.page.findUniqueOrThrow({ where: { id: pageId } });
    expect(page.body).toBe('Typed in editor');
    expect(await prisma.pendingPageChange.count({ where: { pageId } })).toBe(0);
  });

  it('title-only change creates no pending change and no notice', async () => {
    const notified: string[] = [];
    registerExternalChangeHook((id) => notified.push(id));
    const result = await write(undefined, live, { title: 'Renamed' });
    expect(result.pendingMerge).toBe(false);
    expect(notified).not.toContain(pageId);
    const page = await prisma.page.findUniqueOrThrow({ where: { id: pageId } });
    expect(page.title).toBe('Renamed');
    expect(page.body).toBe('Original body');
    expect(await prisma.pendingPageChange.count({ where: { pageId } })).toBe(0);
  });

  it('a second external write equal to the base still queues as a new version', async () => {
    const first = await write('First change', live);
    const second = await write('Original body', live);
    expect(second.pendingMerge).toBe(true);
    expect(second.version?.id).not.toBe(first.version?.id);
    const pending = await prisma.pendingPageChange.findUniqueOrThrow({ where: { pageId } });
    expect(pending.externalVersionId).toBe(second.version!.id);
    expect(pending.baseBody).toBe('Original body');
    const external = await prisma.pageVersion.count({ where: { pageId, kind: 'EXTERNAL' } });
    expect(external).toBe(2);
  });

  it('an identical repeat of the queued body creates no new version', async () => {
    await write('First change', live);
    const again = await write('First change', live);
    expect(again.version).toBeNull();
    expect(await prisma.pageVersion.count({ where: { pageId, kind: 'EXTERNAL' } })).toBe(1);
  });

  it('restore with a live room records a pending RESTORE change', async () => {
    await prisma.pageVersion.create({
      data: { pageId, version: 2, title: 'Start', body: 'Older body', authorId: userId },
    });
    const result = await writePageBody(
      {
        pageId,
        authorId: userId,
        title: 'Start',
        body: 'Older body',
        kind: 'RESTORE',
        source: 'restore',
      },
      live,
    );
    expect(result.pendingMerge).toBe(true);
    const pending = await prisma.pendingPageChange.findUniqueOrThrow({
      where: { pageId },
      include: { externalVersion: true },
    });
    expect(pending.externalVersion.kind).toBe('RESTORE');
    expect((await prisma.page.findUniqueOrThrow({ where: { id: pageId } })).body).toBe(
      'Original body',
    );
    // restoreVersion with no live room still goes through the same helper
    const restored = await restoreVersion(spaceId, 'pw-page', 1, userId);
    expect(restored.pendingMerge).toBe(false);
  });

  it('createPage stores normalised Markdown in the page and its first version', async () => {
    const raw = '* one\n* two\n\n\n\nText with   spaces';
    const normalised = normalizeMarkdown(raw);
    const page = await createPage(spaceId, userId, { title: 'Raw', slug: 'raw-page', body: raw });
    expect(page.body).toBe(normalised);
    expect(page.versions[0].body).toBe(normalised);
  });
});
