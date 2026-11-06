/**
 * The live blocks of one page rendered in one request: one render against the limit and one read
 * slot for the page, each block with the reader's own rights, and a block that fails fails alone.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../../config/database';
import {
  addMemberToContext,
  cleanupTestContext,
  createTestContext,
  type TestContext,
  type TestUser,
} from '../../test/factory';
import { authPost } from '../../test/helpers';

import { RENDER_LIMIT } from './dashboards.service';

const MARK = `batch${Date.now()}`;
const COUNTING = `title ~ ${MARK}`;

interface Entry {
  embedId: string;
  block?: { widgets: Array<{ title: string; result: { total?: number } }>; projectIds: string[] };
  error?: { status: number; code: string; message: string };
}

describe('dashboard.renderEmbeddedBatch', () => {
  let ctx: TestContext;
  let author: TestUser;
  let reader: TestUser;
  let dashboardId: string;
  let savedId: string;
  let pageId: string;
  let inline: string;

  const act = (user: TestUser, input: object) =>
    authPost('/api/act', user.token, { action: 'dashboard.renderEmbeddedBatch', input });

  const batch = async (user: TestUser, embedIds: string[], page = pageId) => {
    const res = await act(user, { pageId: page, embedIds });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.blocks as Entry[];
  };

  beforeAll(async () => {
    ctx = await createTestContext(`embbatch${Date.now()}`);
    for (let n = 0; n < 2; n++) {
      await prisma.issue.create({
        data: {
          projectId: ctx.projectId,
          number: 9100 + n,
          title: `Issue ${MARK}`,
          body: '',
          creatorId: ctx.owner.id,
        },
      });
    }
    author = ctx.owner;
    reader = await addMemberToContext(ctx);
    const space = await prisma.wikiSpace.create({
      data: { teamId: ctx.teamId, name: 'Batch', slug: `batch-${MARK}` },
    });

    const created = await authPost('/api/act', author.token, {
      action: 'dashboard.create',
      input: { name: `Board ${MARK}` },
    });
    dashboardId = created.body.id;
    await authPost('/api/act', author.token, {
      action: 'dashboardWidget.add',
      input: { id: dashboardId, type: 'COUNT', title: 'Marked', query: COUNTING },
    });
    const saved = await authPost('/api/act', author.token, {
      action: 'savedQuery.create',
      input: { name: `Saved ${MARK}`, text: COUNTING },
    });
    savedId = saved.body.id;
    inline = `inline:${JSON.stringify(`${COUNTING} GROUP BY project`)}`;
    pageId = (
      await prisma.page.create({
        data: {
          spaceId: space.id,
          title: 'Batch',
          slug: `p-${MARK}`,
          body: [
            `:::query dashboard:${dashboardId}:::`,
            `:::query ${savedId}:::`,
            `:::query ${inline}:::`,
            `:::query inline:${JSON.stringify('x'.repeat(1001))}:::`,
          ].join('\n\n'),
        },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.dashboard.deleteMany({ where: { ownerId: author.id } });
    await prisma.savedFilter.deleteMany({ where: { userId: author.id } });
    await prisma.wikiSpace.deleteMany({ where: { teamId: ctx.teamId } });
    await cleanupTestContext(ctx);
    await prisma.user.deleteMany({ where: { id: reader.id } });
  });

  it('renders every block of the page, in the order asked, with the reader own rights', async () => {
    const entries = await batch(reader, [`dashboard:${dashboardId}`, savedId, inline]);
    expect(entries.map((e) => e.embedId)).toEqual([`dashboard:${dashboardId}`, savedId, inline]);
    expect(entries.every((e) => e.block && !e.error)).toBe(true);
    expect(entries[0].block?.widgets[0].title).toBe('Marked');
    expect(entries[0].block?.widgets[0].result.total).toBe(2);
    expect(entries[0].block?.projectIds).toEqual([ctx.projectId]);
  });

  it('fails a block alone: one that is not on the page, one that is too long', async () => {
    const tooLong = `inline:${JSON.stringify('x'.repeat(1001))}`;
    const entries = await batch(reader, [
      `dashboard:${dashboardId}`,
      'dashboard:not-on-this-page',
      tooLong,
      savedId,
    ]);
    expect(entries[0].block).toBeDefined();
    expect(entries[1].error?.status).toBe(404);
    expect(entries[1].block).toBeUndefined();
    expect(entries[2].error?.status).toBe(400);
    expect(entries[2].error?.code).toBe('INVALID_QUERY');
    expect(entries[3].block).toBeDefined();
  });

  it('answers a page the reader cannot open like one that does not exist', async () => {
    const stranger = await createTestContext(`embstr${Date.now()}`);
    try {
      const res = await act(stranger.owner, { pageId, embedIds: [savedId] });
      expect(res.status).toBe(404);
    } finally {
      await cleanupTestContext(stranger);
    }
  });

  it('counts once against the render limit, however many blocks the page has', async () => {
    const user = await addMemberToContext(ctx);
    const embedIds = [`dashboard:${dashboardId}`, savedId, inline];
    const statuses: number[] = [];
    for (let i = 0; i <= RENDER_LIMIT.max; i++) {
      statuses.push((await act(user, { pageId, embedIds })).status);
    }
    // three blocks per request would have been refused after a third of the limit
    expect(statuses.slice(0, RENDER_LIMIT.max).every((status) => status === 200)).toBe(true);
    expect(statuses[RENDER_LIMIT.max]).toBe(429);
    await prisma.user.deleteMany({ where: { id: user.id } });
  });

  it('refuses an empty list and one past the cap', async () => {
    expect((await act(reader, { pageId, embedIds: [] })).status).toBe(400);
    const many = Array.from({ length: 51 }, (_, i) => `dashboard:d${i}`);
    expect((await act(reader, { pageId, embedIds: many })).status).toBe(400);
  });

  it('is reachable over REST', async () => {
    const res = await authPost('/api/dashboards/embedded/batch', reader.token, {
      pageId,
      embedIds: [savedId],
    });
    expect(res.status).toBe(200);
    expect(res.body.blocks[0].block.widgets).toHaveLength(1);
  });
});
