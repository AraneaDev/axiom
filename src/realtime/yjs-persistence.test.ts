import bcrypt from 'bcryptjs';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as Y from 'yjs';

import { prisma } from '../config/database';
import { markdownToYFragment, yFragmentToMarkdown } from '../lib/editor-core';

import { getOrCreateRoom, releaseRoomForTest } from './collaboration';
import { clearAuthor, forceSave, loadPageIntoDoc, setLastAuthor } from './yjs-persistence';

describe('Yjs persistence', () => {
  const BODY = '# Hello\n\nSome body text';
  let orgId: string;
  let userId: string;
  let pageId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        email: 'yjs-persist@axiom.dev',
        username: 'yjs-persist-user',
        displayName: 'Yjs Persist',
        passwordHash: await bcrypt.hash('testpassword123', 4),
      },
    });
    userId = user.id;
    const org = await prisma.organization.create({
      data: { name: 'Yjs Persist Org', slug: 'yjs-persist-org' },
    });
    orgId = org.id;
    const team = await prisma.team.create({
      data: { orgId, name: 'Yjs Team', slug: 'yjs-team' },
    });
    const space = await prisma.wikiSpace.create({
      data: { teamId: team.id, name: 'Yjs Space', slug: 'yjs-space' },
    });
    const page = await prisma.page.create({
      data: { spaceId: space.id, title: 'Yjs Page', slug: 'yjs-page', body: BODY },
    });
    pageId = page.id;
  });

  afterAll(async () => {
    await prisma.organization.delete({ where: { id: orgId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  /** One collab session without edits: load, client replies with sync step 2, last client leaves. */
  async function openAndCloseWithoutEdits() {
    const doc = new Y.Doc();
    await loadPageIntoDoc(pageId, doc);
    setLastAuthor(pageId, userId); // what the SyncStep2 reply does in collaboration.ts
    await forceSave(pageId, doc);
    clearAuthor(pageId);
    doc.destroy();
  }

  it('does not rewrite the page or add versions when a session has no edits', async () => {
    await openAndCloseWithoutEdits();
    await openAndCloseWithoutEdits();

    const page = await prisma.page.findUniqueOrThrow({ where: { id: pageId } });
    const versions = await prisma.pageVersion.count({ where: { pageId } });
    expect(page.body).toBe(BODY);
    expect(versions).toBe(0);
  });

  it('persists a session that edits the document', async () => {
    const doc = new Y.Doc();
    await loadPageIntoDoc(pageId, doc);
    doc.getXmlFragment('default').insert(0, [new Y.XmlElement('paragraph')]);
    setLastAuthor(pageId, userId);
    await forceSave(pageId, doc);
    clearAuthor(pageId);
    doc.destroy();

    const page = await prisma.page.findUniqueOrThrow({ where: { id: pageId } });
    expect(page.body).not.toBe(BODY);
    expect(await prisma.pageVersion.count({ where: { pageId } })).toBe(1);
  });

  it('loads markdown as structure', async () => {
    const other = await prisma.page.create({
      data: {
        spaceId: (await prisma.page.findUniqueOrThrow({ where: { id: pageId } })).spaceId,
        title: 'Structure Page',
        slug: 'structure-page',
        body: '# H\n\ntext',
      },
    });
    const doc = new Y.Doc();
    await loadPageIntoDoc(other.id, doc);
    const first = doc.getXmlFragment('default').get(0) as Y.XmlElement;
    expect(first.nodeName).toBe('heading');
    clearAuthor(other.id);
    doc.destroy();
  });

  it('saves markdown, not XML', async () => {
    const other = await prisma.page.create({
      data: {
        spaceId: (await prisma.page.findUniqueOrThrow({ where: { id: pageId } })).spaceId,
        title: 'Save Page',
        slug: 'save-page',
        body: '# H\n\ntext',
      },
    });
    const doc = new Y.Doc();
    await loadPageIntoDoc(other.id, doc);
    const fragment = doc.getXmlFragment('default');
    const paragraph = new Y.XmlElement('paragraph');
    paragraph.insert(0, [new Y.XmlText('added')]);
    fragment.insert(fragment.length, [paragraph]);
    setLastAuthor(other.id, userId);
    await forceSave(other.id, doc);
    clearAuthor(other.id);
    doc.destroy();

    const saved = await prisma.page.findUniqueOrThrow({ where: { id: other.id } });
    expect(saved.body).not.toContain('<paragraph');
    expect(saved.body).toBe('# H\n\ntext\n\nadded');
    const version = await prisma.pageVersion.findFirstOrThrow({ where: { pageId: other.id } });
    expect(version.body).toBe(saved.body);
  });

  it('concurrent first connections share one room', async () => {
    const [a, b] = await Promise.all([getOrCreateRoom(pageId), getOrCreateRoom(pageId)]);
    expect(a).toBe(b);
    expect(await getOrCreateRoom(pageId)).toBe(a);
    releaseRoomForTest(pageId);
  });

  it('uses one Yjs instance across converter, collab server and y-protocols', async () => {
    // The same specifiers collaboration.ts uses, resolved the same way.
    const syncProtocol = await import('y-protocols/sync');
    const encoding = await import('lib0/encoding');
    const decoding = await import('lib0/decoding');

    const server = new Y.Doc();
    markdownToYFragment('# Title\n\n- one\n- two', server.getXmlFragment('default'));
    const client = new Y.Doc();

    // Step 1 from the client, step 2 from the server, exactly like the collab handshake.
    const e1 = encoding.createEncoder();
    syncProtocol.writeSyncStep1(e1, client);
    const reply = encoding.createEncoder();
    syncProtocol.readSyncMessage(
      decoding.createDecoder(encoding.toUint8Array(e1)),
      reply,
      server,
      null,
    );
    syncProtocol.readSyncMessage(
      decoding.createDecoder(encoding.toUint8Array(reply)),
      encoding.createEncoder(),
      client,
      null,
    );

    expect(client.getXmlFragment('default').length).toBe(2);
    expect((client.getXmlFragment('default').get(0) as Y.XmlElement).nodeName).toBe('heading');
    expect(yFragmentToMarkdown(client.getXmlFragment('default'))).toBe('# Title\n\n- one\n- two');
  });

  it('persists a revert to the loaded content after an earlier save', async () => {
    const other = await prisma.page.create({
      data: {
        spaceId: (await prisma.page.findUniqueOrThrow({ where: { id: pageId } })).spaceId,
        title: 'Revert Page',
        slug: 'revert-page',
        body: BODY,
      },
    });
    const id = other.id;
    const doc = new Y.Doc();
    await loadPageIntoDoc(id, doc);
    const loaded = yFragmentToMarkdown(doc.getXmlFragment('default'));
    setLastAuthor(id, userId);

    const extra = new Y.XmlElement('paragraph');
    doc.getXmlFragment('default').insert(0, [extra]);
    await forceSave(id, doc);
    const afterEdit = await prisma.page.findUniqueOrThrow({ where: { id } });
    expect(afterEdit.body).not.toBe(loaded);
    expect(await prisma.pageVersion.count({ where: { pageId: id } })).toBe(1);

    doc.getXmlFragment('default').delete(0, 1); // back to exactly the loaded state
    await forceSave(id, doc);
    const afterRevert = await prisma.page.findUniqueOrThrow({ where: { id } });
    expect(afterRevert.body).toBe(loaded);
    expect(await prisma.pageVersion.count({ where: { pageId: id } })).toBe(2);
    clearAuthor(id);
    doc.destroy();
  });
});
