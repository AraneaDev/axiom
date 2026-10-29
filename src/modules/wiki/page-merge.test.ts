import bcrypt from 'bcryptjs';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';

import { prisma } from '../../config/database';
import app from '../../index';
import { normalizeMarkdown, yFragmentToMarkdown } from '../../lib/editor-core';
import { getOrCreateRoom, isRoomLive, roomSettled } from '../../realtime/collaboration';
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
    const org = await prisma.organization.create({
      data: {
        name: 'Merge Test Org',
        slug: `${SLUG}-org`,
        members: {
          create: [
            { userId: ownerId, role: 'OWNER' },
            { userId: editorId, role: 'MEMBER' },
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
      externalVersionId: written.version!.id,
      authorName: 'Merge Owner',
      at: written.version!.createdAt.toISOString(),
    });
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
  });

  it('pending merge with no room and no draft uses the base as ours', async () => {
    const client = await connect(editorId);
    await externalWrite('Intro\n\nMiddle changed\n\nEnd');
    await disconnect(client);
    const merge = await getPendingMerge(pageId, editorId);
    expect(merge?.ours).toBe('Intro\n\nMiddle\n\nEnd');
  });

  it('applyMerge writes MERGE, clears pending, and updates the live doc', async () => {
    const a = await connect(editorId);
    const b = await connect(ownerId);
    const written = await externalWrite('Intro\n\nMiddle changed\n\nEnd');
    await waitFor(() => b.changeMessages.length > 0);

    await applyMerge(pageId, editorId, {
      externalVersionId: written.version!.id,
      markdown: 'Intro\n\nMiddle changed\n\nEnd\n\n\n\nMerged *tail*',
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
      { externalVersionId: written.version!.id, markdown: 'Merged' },
      { syncIssueLinks: async (id, body) => void calls.push(`${id}:${body}`) },
    );
    expect(calls).toEqual([`${pageId}:Merged`]);
    await disconnect(client);
  });

  it('stale externalVersionId returns 409', async () => {
    await connect(editorId);
    const first = await externalWrite('Intro\n\nOne\n\nEnd');
    await externalWrite('Intro\n\nTwo\n\nEnd');

    const res = await api('post', '/merge').send({
      externalVersionId: first.version!.id,
      markdown: 'Whatever',
    });
    expect(res.status).toBe(409);
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
    });
    expect(applied.status).toBe(204);
    const after = await api('get', '/pending-merge');
    expect(after.status).toBe(200);
    expect(after.body).toBeNull();
  });

  it('unmerged edits from an ended session merge from the draft', async () => {
    // Session edits, an agent writes, the session ends: its work is kept as a draft
    const session = await connect(editorId);
    appendParagraph(session.doc, 'Session line');
    await waitFor(async () => (await roomMarkdown()).includes('Session line'));
    const written = await externalWrite('Intro\n\nMiddle changed\n\nEnd');
    await disconnect(session);

    // A new session opens from Page.body, the agent's version
    const next = await connect(ownerId);
    expect(yFragmentToMarkdown(next.doc.getXmlFragment('default'))).toBe(
      'Intro\n\nMiddle changed\n\nEnd',
    );
    await waitFor(() => next.changeMessages.length > 0);
    expect(next.changeMessages[0].draftAuthorName).toBe('Merge Editor');

    const merge = await getPendingMerge(pageId, ownerId);
    expect(merge).toMatchObject({
      base: 'Intro\n\nMiddle\n\nEnd',
      theirs: 'Intro\n\nMiddle changed\n\nEnd',
      ours: 'Intro\n\nMiddle\n\nEnd\n\nSession line',
      externalVersionId: written.version!.id,
    });

    const result = 'Intro\n\nMiddle changed\n\nEnd\n\nSession line';
    await applyMerge(pageId, ownerId, { externalVersionId: written.version!.id, markdown: result });
    expect((await prisma.page.findUniqueOrThrow({ where: { id: pageId } })).body).toBe(result);
    await waitFor(() => yFragmentToMarkdown(next.doc.getXmlFragment('default')) === result);
    expect(await prisma.pendingPageChange.count({ where: { pageId } })).toBe(0);
  });

  it('a session opened after the change that has edits is ours', async () => {
    const first = await connect(editorId);
    await externalWrite('Intro\n\nMiddle changed\n\nEnd');
    await disconnect(first);

    const next = await connect(editorId);
    appendParagraph(next.doc, 'New session line');
    await waitFor(async () => (await roomMarkdown()).includes('New session line'));
    const merge = await getPendingMerge(pageId, editorId);
    expect(merge?.ours).toBe('Intro\n\nMiddle changed\n\nEnd\n\nNew session line');
  });
});
