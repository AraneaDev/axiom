/**
 * What a token does with the wiki actions that deleted or toggled before the migration (plan 4):
 * the three deletes wait for approval with a preview, the toggles run, and a label name with a
 * percent sign is read once, by REST and by name.
 */
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../../config/database';
import app from '../../index';
import { cleanupTestContext, createTestContext, type TestContext } from '../../test/factory';
import { authDel, authPost } from '../../test/helpers';
import { tokenHeaderFor } from '../../test/mcp-client';

const XHR = { 'X-Requested-With': 'XMLHttpRequest' };

describe('wiki actions run by a token', () => {
  let ctx: TestContext;
  let token: string;
  let spaceId: string;
  let pageId: string;
  let commentId: string;
  let templateId: string;

  beforeAll(async () => {
    ctx = await createTestContext(`wikitok${Date.now()}`);
    token = await tokenHeaderFor(ctx.owner, ['wiki:write'], 'wiki-writer');
    const space = await prisma.wikiSpace.create({
      data: { teamId: ctx.teamId, name: 'Tok', slug: 'tok' },
    });
    spaceId = space.id;
    pageId = (
      await prisma.page.create({
        data: { spaceId, title: 'Tok page', slug: 'tok-page', body: 'x' },
      })
    ).id;
    commentId = (
      await prisma.pageComment.create({
        data: { pageId, userId: ctx.owner.id, body: 'Remember the milk' },
      })
    ).id;
    templateId = (
      await prisma.pageTemplate.create({ data: { spaceId, name: 'Retro notes', body: 'x' } })
    ).id;
  });

  afterAll(async () => {
    await cleanupTestContext(ctx);
  });

  const withToken = (method: 'delete' | 'post', path: string) =>
    request(app)[method](path).set('Authorization', token).set(XHR);

  it.each([
    ['pageComment.delete', () => `/api/wiki/comments/${commentId}`, 'Remember the milk'],
    ['pageTemplate.delete', () => `/api/wiki/templates/${templateId}`, 'Retro notes'],
  ])('holds %s for approval with a preview, and deletes nothing', async (_name, path, quoted) => {
    const res = await withToken('delete', path());
    expect(res.status).toBe(202);
    expect(res.body.status).toBe('pending_approval');
    expect(res.body.preview).toContain(quoted);
    expect(await prisma.pageComment.count({ where: { id: commentId } })).toBe(1);
    expect(await prisma.pageTemplate.count({ where: { id: templateId } })).toBe(1);
  });

  it('holds pageLabel.remove for approval with a preview, and keeps the label', async () => {
    await prisma.pageLabel.create({ data: { pageId, label: 'roadmap' } });
    const res = await withToken('delete', `/api/wiki/pages/${pageId}/labels/roadmap`);
    expect(res.status).toBe(202);
    expect(res.body.preview).toContain('roadmap');
    expect(await prisma.pageLabel.count({ where: { pageId, label: 'roadmap' } })).toBe(1);
  });

  it('lets a token toggle a star and a reaction without approval', async () => {
    const star = await withToken('post', `/api/wiki/pages/${pageId}/star`);
    expect(star.status).toBe(200);
    expect(await prisma.starredPage.count({ where: { pageId, userId: ctx.owner.id } })).toBe(1);
    const react = await withToken('post', `/api/wiki/comments/${commentId}/reactions`).send({
      reactionType: 'thumbsup',
    });
    expect(react.status).toBe(200);
    expect(await prisma.commentReaction.count({ where: { commentId } })).toBe(1);
  });

  describe('a label with a percent sign', () => {
    it('is removed by REST with a session, once encoded, and previewed for a token', async () => {
      await prisma.pageLabel.create({ data: { pageId, label: '100%' } });
      const path = `/api/wiki/pages/${pageId}/labels/${encodeURIComponent('100%')}`;
      const held = await withToken('delete', path);
      expect(held.status).toBe(202);
      expect(held.body.preview).toContain('100%');
      const res = await authDel(path, ctx.owner.token);
      expect(res.status).toBe(204);
      expect(await prisma.pageLabel.count({ where: { pageId, label: '100%' } })).toBe(0);
    });

    it('is removed by name, as typed', async () => {
      await prisma.pageLabel.createMany({
        data: [
          { pageId, label: 'a%20b' },
          { pageId, label: 'a b' },
        ],
      });
      const res = await authPost('/api/act', ctx.owner.token, {
        action: 'pageLabel.remove',
        input: { pageId, label: 'a%20b' },
      });
      expect(res.status).toBe(200);
      const left = await prisma.pageLabel.findMany({
        where: { pageId, label: { in: ['a%20b', 'a b'] } },
      });
      expect(left.map((l) => l.label)).toEqual(['a b']);
    });
  });
});
