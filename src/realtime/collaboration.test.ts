import bcrypt from 'bcryptjs';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import WebSocket from 'ws';

import { prisma } from '../config/database';
import { yFragmentToMarkdown } from '../lib/editor-core';
import { removeOrgMember } from '../modules/orgs/orgs.service';
import { restoreDescription } from '../modules/wiki/page-versions';
import { writePageBody } from '../modules/wiki/page-writes';
import { setRestrictions } from '../modules/wiki/wiki-permissions.service';
import {
  appendParagraph,
  CollabTestClient,
  CollabTestServer,
  connectCollabClient,
  startCollabTestServer,
  waitFor,
} from '../test/collab-client';
import { logger } from '../utils/logger';

import { revokeLiveAccess } from './access-revocation';
import {
  flushRoom,
  getOrCreateRoom,
  isRoomLive,
  isRoomLocked,
  lockRoom,
  releaseRoomForTest,
  roomSettled,
} from './collaboration';

describe('Collaboration server', () => {
  const SLUG = 'collab-test';
  let server: CollabTestServer;
  let orgId: string;
  let spaceId: string;
  let pageId: string;
  const users: Record<'owner' | 'editor' | 'viewer' | 'outsider', string> = {
    owner: '',
    editor: '',
    viewer: '',
    outsider: '',
  };
  const clients: CollabTestClient[] = [];

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash('testpassword123', 4);
    for (const key of Object.keys(users) as Array<keyof typeof users>) {
      const user = await prisma.user.upsert({
        where: { username: `${SLUG}-${key}` },
        update: {},
        create: {
          email: `${SLUG}-${key}@axiom.dev`,
          username: `${SLUG}-${key}`,
          displayName: `Collab ${key}`,
          passwordHash,
        },
      });
      users[key] = user.id;
    }
    const org = await prisma.organization.create({
      data: {
        name: 'Collab Test Org',
        slug: `${SLUG}-org`,
        // Team members are org members too, as the app guarantees
        members: {
          create: [
            { userId: users.owner, role: 'OWNER' },
            { userId: users.editor, role: 'MEMBER' },
            { userId: users.viewer, role: 'MEMBER' },
          ],
        },
      },
    });
    orgId = org.id;
    const team = await prisma.team.create({
      data: {
        orgId,
        name: 'Collab Team',
        slug: `${SLUG}-team`,
        members: {
          create: [
            { userId: users.editor, role: 'MEMBER' },
            { userId: users.viewer, role: 'MEMBER' },
          ],
        },
      },
    });
    const space = await prisma.wikiSpace.create({
      data: {
        teamId: team.id,
        name: 'Collab Space',
        slug: `${SLUG}-space`,
        // Custom permissions: only listed users get in, the viewer only to read
        permissions: {
          create: [
            { userId: users.editor, level: 'EDIT' },
            { userId: users.viewer, level: 'VIEW' },
          ],
        },
      },
    });
    spaceId = space.id;
    server = await startCollabTestServer();
  });

  beforeEach(async () => {
    await prisma.page.deleteMany({ where: { spaceId } });
    const page = await prisma.page.create({
      data: { spaceId, title: 'Collab Page', slug: 'collab-page', body: 'Original body' },
    });
    pageId = page.id;
  });

  afterEach(async () => {
    vi.useRealTimers();
    await Promise.all(clients.splice(0).map((c) => c.close()));
    await waitFor(() => !isRoomLive(pageId));
    await roomSettled(pageId);
  });

  afterAll(async () => {
    await server.close();
    await prisma.organization.delete({ where: { id: orgId } });
    await prisma.user.deleteMany({ where: { username: { startsWith: `${SLUG}-` } } });
  });

  const connect = async (who: keyof typeof users) => {
    const client = connectCollabClient(server, pageId, users[who]);
    clients.push(client);
    await client.synced;
    return client;
  };

  const roomMarkdown = async () =>
    yFragmentToMarkdown((await getOrCreateRoom(pageId)).doc.getXmlFragment('default'));

  const externalWrite = (body: string) =>
    writePageBody({ pageId, authorId: users.owner, body, kind: 'EXTERNAL', source: 'mcp' });

  it('closes with 4003 for a user without access to the space', async () => {
    const client = connectCollabClient(server, pageId, users.outsider);
    clients.push(client);
    expect(await client.closeCode).toBe(4003);
  });

  it('closes with 4003 for a user from another org on an unrestricted space', async () => {
    // No custom space permissions and no page restrictions: only org membership keeps a
    // stranger out, as on the REST routes
    const openSpace = await prisma.wikiSpace.create({
      data: {
        teamId: (await prisma.team.findFirstOrThrow({ where: { orgId } })).id,
        name: 'Open',
        slug: `${SLUG}-open`,
      },
    });
    const openPage = await prisma.page.create({
      data: { spaceId: openSpace.id, title: 'Open page', slug: 'open-page', body: 'open' },
    });
    const stranger = connectCollabClient(server, openPage.id, users.outsider);
    clients.push(stranger);
    expect(await stranger.closeCode).toBe(4003);

    const member = connectCollabClient(server, openPage.id, users.editor);
    clients.push(member);
    await member.synced;
    expect(member.ws.readyState).toBe(WebSocket.OPEN);
    await member.close();
    await waitFor(() => !isRoomLive(openPage.id));
    await roomSettled(openPage.id);
  });

  it('closes the live session of a user removed from the org', async () => {
    const leaver = await prisma.user.create({
      data: {
        email: `${SLUG}-leaver@axiom.dev`,
        username: `${SLUG}-leaver`,
        displayName: 'Leaver',
        passwordHash: 'x',
      },
    });
    const team = await prisma.team.findFirstOrThrow({ where: { orgId } });
    await prisma.orgMembership.create({ data: { orgId, userId: leaver.id, role: 'MEMBER' } });
    await prisma.teamMembership.create({
      data: { teamId: team.id, userId: leaver.id, role: 'MEMBER' },
    });
    await prisma.spacePermission.create({ data: { spaceId, userId: leaver.id, level: 'EDIT' } });

    const client = connectCollabClient(server, pageId, leaver.id);
    clients.push(client);
    await client.synced;

    await removeOrgMember(orgId, leaver.id);
    expect(await client.closeCode).toBe(4003);
  });

  it('tells an editor demoted to read-only, and drops their updates', async () => {
    const editor = await connect('editor');
    // Lower the editor's grant on the space from EDIT to VIEW
    await prisma.spacePermission.updateMany({
      where: { spaceId, userId: users.editor },
      data: { level: 'VIEW' },
    });
    await revokeLiveAccess({ spaceId });
    await waitFor(() => editor.accessMessages.some((m) => m.canEdit === false));
    expect(editor.ws.readyState).toBe(WebSocket.OPEN);
    await prisma.spacePermission.updateMany({
      where: { spaceId, userId: users.editor },
      data: { level: 'EDIT' },
    });
  });

  it('9: closes the matching sessions when the re-check cannot load the page', async () => {
    const editor = await connect('editor');
    vi.spyOn(prisma.page, 'findUnique').mockRejectedValueOnce(new Error('database went away'));
    try {
      await revokeLiveAccess({ userId: users.editor });
      expect(await editor.closeCode).toBe(4003);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('closes a live session when a new page restriction hides the page', async () => {
    const editor = await connect('editor');
    await setRestrictions(pageId, 'VIEW', [users.owner]);
    expect(await editor.closeCode).toBe(4003);
  });

  it('closes with 4003 for a user the page hides', async () => {
    await prisma.pageRestriction.create({
      data: { pageId, type: 'VIEW', userId: users.owner },
    });
    const client = connectCollabClient(server, pageId, users.editor);
    clients.push(client);
    expect(await client.closeCode).toBe(4003);
  });

  it('viewer cannot push updates', async () => {
    const viewer = await connect('viewer');
    const editor = await connect('editor');

    appendParagraph(viewer.doc, 'from viewer');
    appendParagraph(editor.doc, 'from editor');

    // The viewer still receives the editor's update
    await waitFor(() =>
      yFragmentToMarkdown(viewer.doc.getXmlFragment('default')).includes('from editor'),
    );
    await new Promise((r) => setTimeout(r, 100));
    const stored = await roomMarkdown();
    expect(stored).toContain('from editor');
    expect(stored).not.toContain('from viewer');
    expect(yFragmentToMarkdown(editor.doc.getXmlFragment('default'))).not.toContain('from viewer');
  });

  it('a page EDIT restriction makes a space editor read-only', async () => {
    await prisma.pageRestriction.create({ data: { pageId, type: 'EDIT', userId: users.owner } });
    const editor = await connect('editor');
    appendParagraph(editor.doc, 'restricted');
    await new Promise((r) => setTimeout(r, 150));
    expect(await roomMarkdown()).not.toContain('restricted');
  });

  it('external change notifies the room once and replays on connect', async () => {
    const first = await connect('editor');
    const result = await externalWrite('Agent body');
    expect(result.pendingMerge).toBe(true);

    await waitFor(() => first.changeMessages.length > 0);
    await new Promise((r) => setTimeout(r, 100));
    expect(first.changeMessages).toHaveLength(1);
    expect(first.changeMessages[0]).toMatchObject({
      state: 'pending',
      externalVersionId: result.version!.id,
      authorName: 'Collab owner',
      kind: 'EXTERNAL',
    });
    expect(typeof first.changeMessages[0].at).toBe('string');
    expect(first.changeMessages[0].draftAuthorName).toBeUndefined();

    const late = await connect('viewer');
    await waitFor(() => late.changeMessages.length > 0);
    expect(late.changeMessages).toEqual([first.changeMessages[0]]);
  });

  it('a restore notice names the restored version', async () => {
    const client = await connect('editor');
    await writePageBody({
      pageId,
      authorId: users.owner,
      body: 'Restored body',
      kind: 'RESTORE',
      source: 'restore',
      changeDescription: restoreDescription(1),
    });
    await waitFor(() => client.changeMessages.length > 0);
    expect(client.changeMessages[0]).toMatchObject({
      state: 'pending',
      kind: 'RESTORE',
      restoredVersion: 1,
    });
  });

  it('replay after an ended session includes draftAuthorName and draftAt', async () => {
    const session = await connect('editor');
    appendParagraph(session.doc, 'session work');
    await waitFor(async () => (await roomMarkdown()).includes('session work'));
    await externalWrite('Agent body');
    await session.close();
    clients.splice(clients.indexOf(session), 1);
    await waitFor(() => !isRoomLive(pageId));
    await roomSettled(pageId);

    const draft = await prisma.pageVersion.findFirstOrThrow({
      where: { pageId, kind: 'SESSION_DRAFT' },
    });
    const next = await connect('owner');
    await waitFor(() => next.changeMessages.length > 0);
    expect(next.changeMessages[0]).toMatchObject({
      state: 'pending',
      draftAuthorName: 'Collab editor',
      draftAt: draft.createdAt.toISOString(),
    });
    // The new session opens from Page.body, which is the agent's version
    expect(yFragmentToMarkdown(next.doc.getXmlFragment('default'))).toBe('Agent body');
  });

  it('three external writes leave one pending row with the last version', async () => {
    const client = await connect('editor');
    await externalWrite('Agent one');
    await externalWrite('Agent two');
    const last = await externalWrite('Agent three');

    const rows = await prisma.pendingPageChange.findMany({ where: { pageId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].externalVersionId).toBe(last.version!.id);
    expect(rows[0].baseBody).toBe('Original body');
    expect((await prisma.page.findUniqueOrThrow({ where: { id: pageId } })).body).toBe(
      'Agent three',
    );
    await waitFor(() => client.changeMessages.length === 3);
    expect(client.changeMessages[2].externalVersionId).toBe(last.version!.id);
  });

  it('autosave while pending writes SESSION_DRAFT and keeps Page.body', async () => {
    const client = await connect('editor');
    await externalWrite('Agent body');
    appendParagraph(client.doc, 'typed while pending');
    await waitFor(async () => (await roomMarkdown()).includes('typed while pending'));

    expect(await flushRoom(pageId)).toBe(true);

    const page = await prisma.page.findUniqueOrThrow({ where: { id: pageId } });
    expect(page.body).toBe('Agent body');
    const drafts = await prisma.pageVersion.findMany({ where: { pageId, kind: 'SESSION_DRAFT' } });
    expect(drafts).toHaveLength(1);
    expect(drafts[0].body).toBe('Original body\n\ntyped while pending');
    expect(drafts[0].authorId).toBe(users.editor);
    // Saving the same state again adds nothing
    await flushRoom(pageId);
    expect(await prisma.pageVersion.count({ where: { pageId, kind: 'SESSION_DRAFT' } })).toBe(1);
    expect(await prisma.pendingPageChange.count({ where: { pageId } })).toBe(1);
  });

  it('disconnect while pending saves a draft and keeps the pending row', async () => {
    const client = await connect('editor');
    await externalWrite('Agent body');
    appendParagraph(client.doc, 'last words');
    await waitFor(async () => (await roomMarkdown()).includes('last words'));

    await client.close();
    clients.splice(clients.indexOf(client), 1);
    await waitFor(() => !isRoomLive(pageId));
    await roomSettled(pageId);

    const page = await prisma.page.findUniqueOrThrow({ where: { id: pageId } });
    expect(page.body).toBe('Agent body');
    const draft = await prisma.pageVersion.findFirstOrThrow({
      where: { pageId, kind: 'SESSION_DRAFT' },
    });
    expect(draft.body).toBe('Original body\n\nlast words');
    // The row stays, and it records the draft as the work still to merge
    const pending = await prisma.pendingPageChange.findUniqueOrThrow({ where: { pageId } });
    expect(pending.draftVersionId).toBe(draft.id);
  });

  /**
   * An external write in the moment no live room is registered (closing or loading).
   * @param body
   */
  const writeInWindow = (body: string) =>
    writePageBody(
      { pageId, authorId: users.owner, body, kind: 'EXTERNAL', source: 'mcp' },
      { isRoomLive: () => false },
    );

  it('a session save never overwrites an external write made while no room was registered', async () => {
    const session = await connect('editor');
    appendParagraph(session.doc, 'session edit');
    await waitFor(async () => (await roomMarkdown()).includes('session edit'));
    const written = await writeInWindow('Agent body');
    expect(written.pendingMerge).toBe(false);

    await flushRoom(pageId);

    expect((await prisma.page.findUniqueOrThrow({ where: { id: pageId } })).body).toBe(
      'Agent body',
    );
    const pending = await prisma.pendingPageChange.findUniqueOrThrow({
      where: { pageId },
      include: { draftVersion: true },
    });
    expect(pending.baseBody).toBe('Original body');
    expect(pending.externalVersionId).toBe(written.version!.id);
    expect(pending.draftVersion?.kind).toBe('SESSION_DRAFT');
    expect(pending.draftVersion?.body).toBe('Original body\n\nsession edit');
    // The live room is told, and the notice names no draft: the draft is this session's own
    await waitFor(() => session.changeMessages.length > 0);
    expect(session.changeMessages[0]).toMatchObject({
      state: 'pending',
      externalVersionId: written.version!.id,
    });
    expect(session.changeMessages[0].draftAuthorName).toBeUndefined();
    const { getPendingMerge } = await import('../modules/wiki/page-merge');
    const merge = await getPendingMerge(pageId, users.editor);
    expect(merge).toMatchObject({
      ours: 'Original body\n\nsession edit',
      theirs: 'Agent body',
      base: 'Original body',
    });
    expect(merge?.draftAuthorName).toBeUndefined();
  });

  it('a closing session never overwrites an external write made in the closing window', async () => {
    const session = await connect('editor');
    appendParagraph(session.doc, 'closing edit');
    await waitFor(async () => (await roomMarkdown()).includes('closing edit'));
    await writeInWindow('Agent body');

    await session.close();
    clients.splice(clients.indexOf(session), 1);
    await waitFor(() => !isRoomLive(pageId));
    await roomSettled(pageId);

    expect((await prisma.page.findUniqueOrThrow({ where: { id: pageId } })).body).toBe(
      'Agent body',
    );
    const pending = await prisma.pendingPageChange.findUniqueOrThrow({
      where: { pageId },
      include: { draftVersion: true },
    });
    expect(pending.draftVersion?.body).toBe('Original body\n\nclosing edit');
  });

  it('the notice names a draft only when the merge would use it', async () => {
    // A edits, the agent writes, A leaves: A's draft is the unmerged work
    const a = await connect('editor');
    appendParagraph(a.doc, 'from A');
    await waitFor(async () => (await roomMarkdown()).includes('from A'));
    await externalWrite('Agent one');
    await a.close();
    clients.splice(clients.indexOf(a), 1);
    await waitFor(() => !isRoomLive(pageId));
    await roomSettled(pageId);

    // B opens after that change: the notice names A's draft, and so does the merge
    const b = await connect('owner');
    await waitFor(() => b.changeMessages.length > 0);
    const { getPendingMerge } = await import('../modules/wiki/page-merge');
    expect(b.changeMessages[0].draftAuthorName).toBe('Collab editor');
    expect((await getPendingMerge(pageId, users.owner))?.draftAuthorName).toBe('Collab editor');

    // The agent writes again: B now predates the change, the merge is B against the page, and
    // the notice no longer names A's draft
    await externalWrite('Agent two');
    await waitFor(() => b.changeMessages.length > 1);
    expect(b.changeMessages[1].draftAuthorName).toBeUndefined();
    expect((await getPendingMerge(pageId, users.owner))?.draftAuthorName).toBeUndefined();
  });

  it('a session that ends without edits clears the pending change', async () => {
    // An agent writes while a session is open; the session closes without having edited
    const session = await connect('editor');
    await externalWrite('Agent body');
    await waitFor(() => session.changeMessages.length > 0);
    await session.close();
    clients.splice(clients.indexOf(session), 1);
    await waitFor(() => !isRoomLive(pageId));
    await roomSettled(pageId);
    expect(await prisma.pendingPageChange.count({ where: { pageId } })).toBe(0);

    // The next session gets no notice, and its edits reach Page.body
    const next = await connect('editor');
    expect(yFragmentToMarkdown(next.doc.getXmlFragment('default'))).toBe('Agent body');
    appendParagraph(next.doc, 'after the agent');
    await waitFor(async () => (await roomMarkdown()).includes('after the agent'));
    await flushRoom(pageId);
    expect((await prisma.page.findUniqueOrThrow({ where: { id: pageId } })).body).toBe(
      'Agent body\n\nafter the agent',
    );
    expect(next.changeMessages).toEqual([]);
  });

  it('a room that loads over a pending change without a draft clears it', async () => {
    // A pending row left behind (for example by a save that failed) with no draft to merge
    await writePageBody(
      { pageId, authorId: users.owner, body: 'Agent body', kind: 'EXTERNAL', source: 'mcp' },
      { isRoomLive: () => true },
    );
    expect(await prisma.pendingPageChange.count({ where: { pageId } })).toBe(1);

    const next = await connect('editor');
    expect(await prisma.pendingPageChange.count({ where: { pageId } })).toBe(0);
    await new Promise((r) => setTimeout(r, 100));
    expect(next.changeMessages).toEqual([]);
  });

  it('a room that loads over a pending change with a draft keeps it', async () => {
    const session = await connect('editor');
    await externalWrite('Agent body');
    appendParagraph(session.doc, 'unmerged');
    await waitFor(async () => (await roomMarkdown()).includes('unmerged'));
    await session.close();
    clients.splice(clients.indexOf(session), 1);
    await waitFor(() => !isRoomLive(pageId));
    await roomSettled(pageId);

    const next = await connect('editor');
    await waitFor(() => next.changeMessages.length > 0);
    expect(await prisma.pendingPageChange.count({ where: { pageId } })).toBe(1);
  });

  it('a session opened after the change writes no draft without edits', async () => {
    const session = await connect('editor');
    await externalWrite('Agent body');
    await session.close();
    clients.splice(clients.indexOf(session), 1);
    await waitFor(() => !isRoomLive(pageId));
    await roomSettled(pageId);

    const reopened = await connect('editor');
    await reopened.close();
    clients.splice(clients.indexOf(reopened), 1);
    await waitFor(() => !isRoomLive(pageId));
    await roomSettled(pageId);
    expect(await prisma.pageVersion.count({ where: { pageId, kind: 'SESSION_DRAFT' } })).toBe(0);
  });

  it('a locked room drops updates and tells clients', async () => {
    const editor = await connect('editor');
    const release = lockRoom(pageId, 'Collab owner');
    expect(release).not.toBeNull();
    await waitFor(() => editor.lockMessages.length > 0);
    expect(editor.lockMessages[0]).toEqual({ locked: true, byName: 'Collab owner' });

    appendParagraph(editor.doc, 'typed while locked');
    await new Promise((r) => setTimeout(r, 150));
    expect(await roomMarkdown()).not.toContain('typed while locked');
    // A second lock while one is held is refused
    expect(lockRoom(pageId, 'Someone else')).toBeNull();

    // A client joining during the lock is told at once
    const late = await connect('viewer');
    await waitFor(() => late.lockMessages.length > 0);
    expect(late.lockMessages[0]).toEqual({ locked: true, byName: 'Collab owner' });

    release!();
    await waitFor(() => editor.lockMessages.length > 1);
    expect(editor.lockMessages[1]).toEqual({ locked: false, byName: 'Collab owner' });
    expect(isRoomLocked(pageId)).toBe(false);
  });

  it('an edit made while locked arrives after unlock', async () => {
    const editor = await connect('editor');
    const watcher = await connect('owner');
    const release = lockRoom(pageId, 'Collab owner')!;
    await waitFor(() => editor.lockMessages.length > 0);

    appendParagraph(editor.doc, 'typed while locked');
    await new Promise((r) => setTimeout(r, 150));
    expect(await roomMarkdown()).not.toContain('typed while locked');

    release();
    await waitFor(async () => (await roomMarkdown()).includes('typed while locked'));
    // Later incremental updates apply again instead of waiting on the missing one
    appendParagraph(editor.doc, 'typed after unlock');
    await waitFor(async () => (await roomMarkdown()).includes('typed after unlock'));
    await waitFor(() =>
      yFragmentToMarkdown(watcher.doc.getXmlFragment('default')).includes('typed after unlock'),
    );
    expect(yFragmentToMarkdown(watcher.doc.getXmlFragment('default'))).toContain(
      'typed while locked',
    );
  });

  it('lock releases after 30s without apply', async () => {
    const room = await getOrCreateRoom(pageId);
    const sent: Uint8Array[] = [];
    const fakeWs = { readyState: WebSocket.OPEN, send: (m: Uint8Array) => sent.push(m) };
    room.clients.set(fakeWs as unknown as WebSocket, {
      ws: fakeWs as unknown as WebSocket,
      userId: users.editor,
      displayName: 'Fake',
      clientId: 1,
      canEdit: true,
    });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      expect(lockRoom(pageId, 'Collab owner')).not.toBeNull();
      expect(isRoomLocked(pageId)).toBe(true);
      vi.advanceTimersByTime(29_999);
      expect(isRoomLocked(pageId)).toBe(true);
      vi.advanceTimersByTime(1);
      expect(isRoomLocked(pageId)).toBe(false);
      // locked, unlocked, then a sync step 1 asking the editor for what was dropped
      expect(sent.map((m) => m[0])).toEqual([21, 21, 0]);
    } finally {
      vi.useRealTimers();
      releaseRoomForTest(pageId);
    }
  });

  it('a failing settle after the last client leaves is logged, never an unhandled rejection', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    const logged = vi.spyOn(logger, 'error');
    try {
      const client = await connect('editor');
      // The closing save runs as usual; the settle after it is the next transaction, and fails
      const original = prisma.$transaction.bind(prisma) as (...args: unknown[]) => unknown;
      vi.spyOn(prisma, '$transaction')
        .mockImplementationOnce(((...args: unknown[]) => original(...args)) as never)
        .mockRejectedValueOnce(new Error('database went away'));
      await client.close();
      clients.splice(clients.indexOf(client), 1);
      await waitFor(() => !isRoomLive(pageId));
      await roomSettled(pageId);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(unhandled).toEqual([]);
      expect(logged).toHaveBeenCalledWith(
        'Failed to settle the pending change after the session',
        { pageId },
        expect.any(Error),
      );
    } finally {
      process.off('unhandledRejection', onUnhandled);
      vi.restoreAllMocks();
    }
  });
});
