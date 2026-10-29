import bcrypt from 'bcryptjs';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as Y from 'yjs';

import { prisma } from '../config/database';

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
});
