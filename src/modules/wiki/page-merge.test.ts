import bcrypt from 'bcryptjs';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';

import { prisma } from '../../config/database';
import app from '../../index';
import { normalizeMarkdown, yFragmentToMarkdown } from '../../lib/editor-core';
import {
  flushRoom,
  getOrCreateRoom,
  isRoomLive,
  isRoomLocked,
  roomSettled,
} from '../../realtime/collaboration';
import {
  appendParagraph,
  CollabTestClient,
  CollabTestServer,
  connectCollabClient,
  startCollabTestServer,
  tokenFor,
  waitFor,
} from '../../test/collab-client';

import { applyMerge, getPendingMerge } from './page-merge';
import { writePageBody } from './page-writes';

describe('Page merge', () => {
  const SLUG = 'merge-test';
  let server: CollabTestServer;
  let orgId: string;
  let ownerId: string;
  let editorId: string;
  let otherId: string;
  let spaceId: string;
  let pageId: string;
  const clients: CollabTestClient[] = [];

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash('testpassword123', 4);
    const owner = await prisma.user.upsert({
      where: { username: `${SLUG}-owner` },
      update: {},
      create: {
        email: `${SLUG}-owner@axiom.dev`,
        username: `${SLUG}-owner`,
        displayName: 'Merge Owner',
        passwordHash,
      },
    });
    ownerId = owner.id;
    const editor = await prisma.user.upsert({
      where: { username: `${SLUG}-editor` },
      update: {},
      create: {
        email: `${SLUG}-editor@axiom.dev`,
        username: `${SLUG}-editor`,
        displayName: 'Merge Editor',
        passwordHash,
      },
    });
    editorId = editor.id;
    const other = await prisma.user.upsert({
      where: { username: `${SLUG}-other` },
      update: {},
      create: {
        email: `${SLUG}-other@axiom.dev`,
        username: `${SLUG}-other`,
        displayName: 'Merge Other',
        passwordHash,
      },
    });
    otherId = other.id;
    const org = await prisma.organization.create({
      data: {
        name: 'Merge Test Org',
        slug: `${SLUG}-org`,
        members: {
          create: [
            { userId: ownerId, role: 'OWNER' },
            { userId: editorId, role: 'MEMBER' },
            { userId: otherId, role: 'MEMBER' },
          ],
        },
      },
    });
    orgId = org.id;
    const team = await prisma.team.create({
      data: {
        orgId,
        name: 'Merge Team',
        slug: `${SLUG}-team`,
        members: {
          create: [
            { userId: ownerId, role: 'ADMIN' },
            { userId: editorId, role: 'MEMBER' },
            { userId: otherId, role: 'MEMBER' },
          ],
        },
      },
    });
    const space = await prisma.wikiSpace.create({
      data: { teamId: team.id, name: 'Merge Space', slug: `${SLUG}-space` },
    });
    spaceId = space.id;
    server = await startCollabTestServer();
  });

  beforeEach(async () => {
    await prisma.page.deleteMany({ where: { spaceId } });
    const page = await prisma.page.create({
      data: {
        spaceId,
        title: 'Merge Page',
        slug: 'merge-page',
        body: 'Intro\n\nMiddle\n\nEnd',
      },
    });
    pageId = page.id;
  });

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((c) => c.close()));
    await waitFor(() => !isRoomLive(pageId));
    await roomSettled(pageId);
  });

  afterAll(async () => {
    await server.close();
    await prisma.organization.delete({ where: { id: orgId } });
    await prisma.user.deleteMany({ where: { username: { startsWith: `${SLUG}-` } } });
  });

  const connect = async (userId: string) => {
    const client = connectCollabClient(server, pageId, userId);
    clients.push(client);
    await client.synced;
    return client;
  };

  const disconnect = async (client: CollabTestClient) => {
    await client.close();
    clients.splice(clients.indexOf(client), 1);
    if (clients.length > 0) return;
    await waitFor(() => !isRoomLive(pageId));
    await roomSettled(pageId);
  };

  const roomMarkdown = async () =>
    yFragmentToMarkdown((await getOrCreateRoom(pageId)).doc.getXmlFragment('default'));

  const externalWrite = (body: string) =>
    writePageBody({ pageId, authorId: ownerId, body, kind: 'EXTERNAL', source: 'mcp' });

  const api = (method: 'get' | 'post', path: string) => {
    const url = `/api/wiki/spaces/${spaceId}/pages/merge-page${path}`;
    const req = method === 'get' ? request(app).get(url) : request(app).post(url);
    return req
      .set('Authorization', `Bearer ${tokenFor(editorId)}`)
      .set('X-Requested-With', 'XMLHttpRequest');
  };

  it('returns null when nothing is pending', async () => {
    expect(await getPendingMerge(pageId, editorId)).toBeNull();
  });

  it('pending merge with a live session uses the room as ours, all normalised', async () => {
    const client = await connect(editorId);
    appendParagraph(client.doc, 'Mine');
    await waitFor(async () => (await roomMarkdown()).includes('Mine'));
    const written = await externalWrite('Intro\n\nMiddle changed\n\nEnd');

    const merge = await getPendingMerge(pageId, editorId);
    expect(merge).toEqual({
      base: normalizeMarkdown('Intro\n\nMiddle\n\nEnd'),
      theirs: 'Intro\n\nMiddle changed\n\nEnd',
      ours: 'Intro\n\nMiddle\n\nEnd\n\nMine',
      oursLabel: 'Yours',
      theirsLabel: 'Merge Owner',
      externalVersionId: written.version!.id,
      authorName: 'Merge Owner',
      at: written.version!.createdAt.toISOString(),
    });
  });

  it("a live session's own drafts are not reported as an ended session's", async () => {
    const client = await connect(editorId);
    await externalWrite('Intro\n\nMiddle changed\n\nEnd');
    appendParagraph(client.doc, 'Autosaved');
    await waitFor(async () => (await roomMarkdown()).includes('Autosaved'));
    const { flushRoom } = await import('../../realtime/collaboration');
    await flushRoom(pageId);

    const merge = await getPendingMerge(pageId, editorId);
    expect(merge?.ours).toBe('Intro\n\nMiddle\n\nEnd\n\nAutosaved');
    expect(merge?.theirsLabel).toBe('Merge Owner');
    expect(merge?.draftAuthorName).toBeUndefined();
  });

  it('pending merge with no room uses the latest session draft as ours', async () => {
    const client = await connect(editorId);
    await externalWrite('Intro\n\nMiddle changed\n\nEnd');
    appendParagraph(client.doc, 'First draft');
    await waitFor(async () => (await roomMarkdown()).includes('First draft'));
    const { flushRoom } = await import('../../realtime/collaboration');
    await flushRoom(pageId);
    appendParagraph(client.doc, 'Second draft');
    await waitFor(async () => (await roomMarkdown()).includes('Second draft'));
    await disconnect(client);

    const merge = await getPendingMerge(pageId, editorId);
    expect(merge?.ours).toBe('Intro\n\nMiddle\n\nEnd\n\nFirst draft\n\nSecond draft');
    expect(merge?.theirs).toBe('Intro\n\nMiddle changed\n\nEnd');
    expect(merge?.base).toBe('Intro\n\nMiddle\n\nEnd');
    // Nobody saved over the change: the page side is still the agent's
    expect(merge?.theirsLabel).toBe('Merge Owner');
  });

  it('a session that ends without edits leaves nothing to merge', async () => {
    const client = await connect(editorId);
    await externalWrite('Intro\n\nMiddle changed\n\nEnd');
    await disconnect(client);
    expect(await getPendingMerge(pageId, editorId)).toBeNull();
  });

  it('applyMerge writes MERGE, clears pending, and updates the live doc', async () => {
    const a = await connect(editorId);
    const b = await connect(ownerId);
    const written = await externalWrite('Intro\n\nMiddle changed\n\nEnd');
    await waitFor(() => b.changeMessages.length > 0);

    await applyMerge(pageId, editorId, {
      externalVersionId: written.version!.id,
      markdown: 'Intro\n\nMiddle changed\n\nEnd\n\n\n\nMerged *tail*',
      ours: await roomMarkdown(),
    });

    const merged = 'Intro\n\nMiddle changed\n\nEnd\n\nMerged *tail*';
    const page = await prisma.page.findUniqueOrThrow({ where: { id: pageId } });
    expect(page.body).toBe(merged);
    const version = await prisma.pageVersion.findFirstOrThrow({
      where: { pageId },
      orderBy: { version: 'desc' },
    });
    expect(version.kind).toBe('MERGE');
    expect(version.body).toBe(merged);
    expect(version.authorId).toBe(editorId);
    expect(await prisma.pendingPageChange.count({ where: { pageId } })).toBe(0);

    expect(await roomMarkdown()).toBe(merged);
    await waitFor(() => yFragmentToMarkdown(b.doc.getXmlFragment('default')) === merged);
    await waitFor(() => yFragmentToMarkdown(a.doc.getXmlFragment('default')) === merged);
    await waitFor(() => b.changeMessages.length > 1);
    expect(b.changeMessages[1]).toEqual({ state: 'resolved', byName: 'Merge Editor' });
    expect(b.lockMessages).toEqual([
      { locked: true, byName: 'Merge Editor' },
      { locked: false, byName: 'Merge Editor' },
    ]);

    // The merged state is the session's new base: closing the session writes nothing more
    const before = await prisma.pageVersion.count({ where: { pageId } });
    await disconnect(a);
    await disconnect(b);
    expect(await prisma.pageVersion.count({ where: { pageId } })).toBe(before);
  });

  it('applyMerge saves the session state as a draft before replacing it', async () => {
    const client = await connect(editorId);
    const written = await externalWrite('Intro\n\nMiddle changed\n\nEnd');
    appendParagraph(client.doc, 'Unsaved');
    await waitFor(async () => (await roomMarkdown()).includes('Unsaved'));

    await applyMerge(pageId, editorId, {
      externalVersionId: written.version!.id,
      markdown: 'Intro\n\nMiddle changed\n\nEnd\n\nUnsaved',
      ours: await roomMarkdown(),
    });

    const kinds = (
      await prisma.pageVersion.findMany({ where: { pageId }, orderBy: { version: 'asc' } })
    ).map((v) => [v.kind, v.body]);
    expect(kinds).toEqual([
      ['EXTERNAL', 'Intro\n\nMiddle changed\n\nEnd'],
      ['SESSION_DRAFT', 'Intro\n\nMiddle\n\nEnd\n\nUnsaved'],
      ['MERGE', 'Intro\n\nMiddle changed\n\nEnd\n\nUnsaved'],
    ]);
  });

  it('applyMerge syncs issue links for the merged body', async () => {
    const client = await connect(editorId);
    const written = await externalWrite('Intro\n\nMiddle changed\n\nEnd');
    const calls: string[] = [];
    await applyMerge(
      pageId,
      editorId,
      { externalVersionId: written.version!.id, markdown: 'Merged', ours: await roomMarkdown() },
      { syncIssueLinks: async (id, body) => void calls.push(`${id}:${body}`) },
    );
    expect(calls).toEqual([`${pageId}:Merged`]);
    await disconnect(client);
  });

  it('an edit made in the session after the fetch survives the merge', async () => {
    const client = await connect(editorId);
    const written = await externalWrite('Intro\n\nMiddle changed\n\nEnd');
    const fetched = await getPendingMerge(pageId, editorId);
    // The browser merged against this snapshot; then someone keeps typing
    appendParagraph(client.doc, 'Typed late');
    await waitFor(async () => (await roomMarkdown()).includes('Typed late'));

    await applyMerge(pageId, editorId, {
      externalVersionId: written.version!.id,
      markdown: 'Intro\n\nMiddle changed\n\nEnd',
      ours: fetched!.ours,
    });

    const expected = 'Intro\n\nMiddle changed\n\nEnd\n\nTyped late';
    expect((await prisma.page.findUniqueOrThrow({ where: { id: pageId } })).body).toBe(expected);
    expect(await roomMarkdown()).toBe(expected);
    expect(await prisma.pendingPageChange.count({ where: { pageId } })).toBe(0);
  });

  it('a late session edit that overlaps the merge is a MERGE_REBASE_CONFLICT 409', async () => {
    const client = await connect(editorId);
    const written = await externalWrite('Intro\n\nMiddle changed\n\nEnd');
    const fetched = await getPendingMerge(pageId, editorId);
    // The late edit and the submitted merge both add a block at the end
    appendParagraph(client.doc, 'Late tail');
    await waitFor(async () => (await roomMarkdown()).includes('Late tail'));

    const res = await api('post', '/merge').send({
      externalVersionId: written.version!.id,
      markdown: 'Intro\n\nMiddle changed\n\nEnd\n\nMerged tail',
      ours: fetched!.ours,
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('MERGE_REBASE_CONFLICT');
    // Nothing was applied: the change is still pending and the session keeps its text
    expect(await prisma.pendingPageChange.count({ where: { pageId } })).toBe(1);
    expect(await roomMarkdown()).toBe('Intro\n\nMiddle\n\nEnd\n\nLate tail');
    expect(isRoomLocked(pageId)).toBe(false);
  });

  it('stale externalVersionId returns 409', async () => {
    await connect(editorId);
    const first = await externalWrite('Intro\n\nOne\n\nEnd');
    await externalWrite('Intro\n\nTwo\n\nEnd');

    const res = await api('post', '/merge').send({
      externalVersionId: first.version!.id,
      markdown: 'Whatever',
      ours: 'Intro\n\nMiddle\n\nEnd',
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('MERGE_STALE');
    expect(await prisma.pendingPageChange.count({ where: { pageId } })).toBe(1);
    expect((await prisma.page.findUniqueOrThrow({ where: { id: pageId } })).body).toBe(
      'Intro\n\nTwo\n\nEnd',
    );
    expect(await roomMarkdown()).toBe('Intro\n\nMiddle\n\nEnd');

    // Nothing pending at all is a 409 as well
    await prisma.pendingPageChange.deleteMany({ where: { pageId } });
    const none = await api('post', '/merge').send({
      externalVersionId: first.version!.id,
      markdown: 'Whatever',
      ours: 'Intro\n\nMiddle\n\nEnd',
    });
    expect(none.status).toBe(409);
  });

  it('routes return the pending merge and apply it', async () => {
    await connect(editorId);
    const written = await externalWrite('Intro\n\nMiddle changed\n\nEnd');

    const got = await api('get', '/pending-merge');
    expect(got.status).toBe(200);
    expect(got.body.externalVersionId).toBe(written.version!.id);
    expect(got.body.theirs).toBe('Intro\n\nMiddle changed\n\nEnd');

    const applied = await api('post', '/merge').send({
      externalVersionId: written.version!.id,
      markdown: 'Done',
      ours: got.body.ours,
    });
    expect(applied.status).toBe(204);
    const after = await api('get', '/pending-merge');
    expect(after.status).toBe(200);
    expect(after.body).toBeNull();
  });

  it('a merge request without ours is rejected with 400', async () => {
    await connect(editorId);
    const written = await externalWrite('Intro\n\nMiddle changed\n\nEnd');
    const res = await api('post', '/merge').send({
      externalVersionId: written.version!.id,
      markdown: 'Overwrite',
    });
    expect(res.status).toBe(400);
    expect(await prisma.pendingPageChange.count({ where: { pageId } })).toBe(1);
    expect((await prisma.page.findUniqueOrThrow({ where: { id: pageId } })).body).toBe(
      'Intro\n\nMiddle changed\n\nEnd',
    );
  });

  /** A's session edits, an agent writes, A's session ends: A's work is kept as a draft */
  const endSessionWithUnmergedDraft = async () => {
    const a = await connect(editorId);
    appendParagraph(a.doc, 'Line from A');
    await waitFor(async () => (await roomMarkdown()).includes('Line from A'));
    const written = await externalWrite('Intro\n\nMiddle changed\n\nEnd');
    await disconnect(a);
    const pending = await prisma.pendingPageChange.findUniqueOrThrow({
      where: { pageId },
      include: { draftVersion: true },
    });
    expect(pending.draftVersion?.body).toBe('Intro\n\nMiddle\n\nEnd\n\nLine from A');
    return { written, draft: pending.draftVersion! };
  };

  it('unmerged edits from an ended session merge from the draft', async () => {
    const { written, draft } = await endSessionWithUnmergedDraft();

    // A new session opens from Page.body, the agent's version
    const next = await connect(ownerId);
    expect(yFragmentToMarkdown(next.doc.getXmlFragment('default'))).toBe(
      'Intro\n\nMiddle changed\n\nEnd',
    );
    await waitFor(() => next.changeMessages.length > 0);
    expect(next.changeMessages[0].draftAuthorName).toBe('Merge Editor');

    const merge = await getPendingMerge(pageId, ownerId);
    expect(merge).toEqual({
      base: 'Intro\n\nMiddle\n\nEnd',
      ours: 'Intro\n\nMiddle changed\n\nEnd',
      oursLabel: 'Yours',
      theirs: 'Intro\n\nMiddle\n\nEnd\n\nLine from A',
      theirsLabel: "Merge Editor's session",
      externalVersionId: written.version!.id,
      authorName: 'Merge Owner',
      at: written.version!.createdAt.toISOString(),
      draftAuthorName: 'Merge Editor',
      draftAt: draft.createdAt.toISOString(),
    });

    const result = 'Intro\n\nMiddle changed\n\nEnd\n\nLine from A';
    await applyMerge(pageId, ownerId, {
      externalVersionId: written.version!.id,
      markdown: result,
      ours: merge!.ours,
    });
    expect((await prisma.page.findUniqueOrThrow({ where: { id: pageId } })).body).toBe(result);
    await waitFor(() => yFragmentToMarkdown(next.doc.getXmlFragment('default')) === result);
    expect(await prisma.pendingPageChange.count({ where: { pageId } })).toBe(0);
  });

  it("a session opened after the change merges with the ended session's draft, keeping both", async () => {
    const { written } = await endSessionWithUnmergedDraft();

    // B opens after the change and edits on top of it
    const b = await connect(otherId);
    appendParagraph(b.doc, 'Line from B');
    await waitFor(async () => (await roomMarkdown()).includes('Line from B'));

    const merge = await getPendingMerge(pageId, otherId);
    expect(merge).toMatchObject({
      base: 'Intro\n\nMiddle\n\nEnd',
      ours: 'Intro\n\nMiddle changed\n\nEnd\n\nLine from B',
      oursLabel: 'Yours',
      theirs: 'Intro\n\nMiddle\n\nEnd\n\nLine from A',
      theirsLabel: "Merge Editor's session",
    });

    // What a block merge of those three produces: the agent's change, A's line and B's line
    const result = 'Intro\n\nMiddle changed\n\nEnd\n\nLine from A\n\nLine from B';
    await applyMerge(pageId, otherId, {
      externalVersionId: written.version!.id,
      markdown: result,
      ours: merge!.ours,
    });
    expect((await prisma.page.findUniqueOrThrow({ where: { id: pageId } })).body).toBe(result);
    await waitFor(() => yFragmentToMarkdown(b.doc.getXmlFragment('default')) === result);
  });

  it("a later session's work never displaces the ended session's draft", async () => {
    const { draft } = await endSessionWithUnmergedDraft();

    // B opens after the change, edits and leaves: B builds on Page.body, so its work is saved
    // there, and A's draft stays the work to merge
    const b = await connect(otherId);
    appendParagraph(b.doc, 'Line from B');
    await waitFor(async () => (await roomMarkdown()).includes('Line from B'));
    await disconnect(b);

    const pending = await prisma.pendingPageChange.findUniqueOrThrow({ where: { pageId } });
    expect(pending.draftVersionId).toBe(draft.id);
    expect((await prisma.page.findUniqueOrThrow({ where: { id: pageId } })).body).toBe(
      'Intro\n\nMiddle changed\n\nEnd\n\nLine from B',
    );

    const merge = await getPendingMerge(pageId, editorId);
    expect(merge).toMatchObject({
      ours: 'Intro\n\nMiddle\n\nEnd\n\nLine from A',
      oursLabel: "Merge Editor's session",
      theirs: 'Intro\n\nMiddle changed\n\nEnd\n\nLine from B',
      // Page.body holds B's work on top of the agent's change now
      theirsLabel: 'Current page',
    });
  });

  it("a second agent change while a later session is open keeps the ended session's draft", async () => {
    const { draft } = await endSessionWithUnmergedDraft();

    // B opens after change 1 and saves edits on top of it
    const b = await connect(otherId);
    appendParagraph(b.doc, 'Line from B');
    await waitFor(async () => (await roomMarkdown()).includes('Line from B'));
    await flushRoom(pageId);
    const beforeSecond = 'Intro\n\nMiddle changed\n\nEnd\n\nLine from B';
    expect((await prisma.page.findUniqueOrThrow({ where: { id: pageId } })).body).toBe(
      beforeSecond,
    );

    // Change 2 arrives while B is open; B keeps typing
    const second = await externalWrite('Intro changed\n\nMiddle changed\n\nEnd\n\nLine from B');
    appendParagraph(b.doc, 'More from B');
    await waitFor(async () => (await roomMarkdown()).includes('More from B'));
    await waitFor(() => b.changeMessages.some((m) => m.externalVersionId === second.version!.id));
    const notice = b.changeMessages.find((m) => m.externalVersionId === second.version!.id)!;
    expect(notice.draftAuthorName).toBeUndefined();

    // The base is what change 2 replaced, not the body from before change 1
    const merge = await getPendingMerge(pageId, otherId);
    expect(merge).toMatchObject({
      base: beforeSecond,
      ours: `${beforeSecond}\n\nMore from B`,
      theirs: 'Intro changed\n\nMiddle changed\n\nEnd\n\nLine from B',
    });
    expect(merge!.draftAuthorName).toBeUndefined();

    const result = 'Intro changed\n\nMiddle changed\n\nEnd\n\nLine from B\n\nMore from B';
    await applyMerge(pageId, otherId, {
      externalVersionId: second.version!.id,
      markdown: result,
      ours: merge!.ours,
    });
    await waitFor(() => yFragmentToMarkdown(b.doc.getXmlFragment('default')) === result);

    // A's draft is still waiting, now against the merged page, and the room is told so
    const pending = await prisma.pendingPageChange.findUniqueOrThrow({
      where: { pageId },
      include: { externalVersion: true },
    });
    expect(pending.draftVersionId).toBe(draft.id);
    expect(pending.externalVersion.kind).toBe('MERGE');
    await waitFor(() => b.changeMessages.some((m) => m.draftAuthorName === 'Merge Editor'));

    const next = await getPendingMerge(pageId, otherId);
    expect(next).toMatchObject({
      base: 'Intro\n\nMiddle\n\nEnd',
      ours: result,
      theirs: 'Intro\n\nMiddle\n\nEnd\n\nLine from A',
      theirsLabel: "Merge Editor's session",
      externalVersionId: pending.externalVersionId,
      draftAuthorName: 'Merge Editor',
    });
    const final = `${result}\n\nLine from A`;
    await applyMerge(pageId, otherId, {
      externalVersionId: pending.externalVersionId,
      markdown: final,
      ours: next!.ours,
    });
    expect((await prisma.page.findUniqueOrThrow({ where: { id: pageId } })).body).toBe(final);
    expect(await prisma.pendingPageChange.count({ where: { pageId } })).toBe(0);
  });

  describe('saving a live session with a change description', () => {
    const flush = (body: Record<string, unknown>) =>
      request(app)
        .post(`/api/wiki/spaces/${spaceId}/pages/merge-page/collab/flush`)
        .set('Authorization', `Bearer ${tokenFor(editorId)}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send(body);
    const newest = () =>
      prisma.pageVersion.findFirstOrThrow({ where: { pageId }, orderBy: { version: 'desc' } });

    it('puts the description on the version the save creates', async () => {
      const client = await connect(editorId);
      appendParagraph(client.doc, 'Saved with a note');
      await waitFor(async () => (await roomMarkdown()).includes('Saved with a note'));

      const res = await flush({ changeDescription: 'Explain the change' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ flushed: true });
      const version = await newest();
      expect(version.body).toContain('Saved with a note');
      expect(version).toMatchObject({ kind: 'EDIT', changeDescription: 'Explain the change' });
    });

    it('keeps the description on a version of the unchanged page when nothing changed', async () => {
      await connect(editorId);
      const before = await prisma.pageVersion.count({ where: { pageId } });

      expect((await flush({ changeDescription: 'Reviewed, no changes' })).status).toBe(200);
      expect(await prisma.pageVersion.count({ where: { pageId } })).toBe(before + 1);
      expect(await newest()).toMatchObject({
        kind: 'EDIT',
        body: 'Intro\n\nMiddle\n\nEnd',
        authorId: editorId,
        changeDescription: 'Reviewed, no changes',
      });
    });

    it('creates nothing without a description when nothing changed', async () => {
      await connect(editorId);
      const before = await prisma.pageVersion.count({ where: { pageId } });
      expect((await flush({})).status).toBe(200);
      expect(await prisma.pageVersion.count({ where: { pageId } })).toBe(before);
    });
  });
});
