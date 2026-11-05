/**
 * A dashboard or query embedded in a wiki page: its readers see it with their own rights, whoever
 * may open the dashboard itself, and learn nothing of its query text or its sharing.
 */
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { readSlots, READ_CONCURRENCY } from '../../actions/read.service';
import { prisma } from '../../config/database';
import app from '../../index';
import { AppError } from '../../middleware/errorHandler';
import {
  addMemberToContext,
  cleanupTestContext,
  createTestContext,
  createTestUser,
  type TestContext,
  type TestUser,
} from '../../test/factory';
import { authPost } from '../../test/helpers';
import { tokenHeaderFor } from '../../test/mcp-client';

import { RENDER_LIMIT } from './dashboards.service';

const MARK = `embed${Date.now()}`;
const COUNTING = `title ~ ${MARK}`;

interface EmbeddedWidget {
  id: string;
  type: string;
  title: string;
  result: {
    error?: { message: string; code: string; status: number };
    kind?: string;
    total?: number;
    items?: unknown[];
    groups?: Array<{ count: number }>;
    sprints?: unknown[];
  };
}

describe('dashboard.renderEmbedded', () => {
  let a: TestContext;
  let b: TestContext;
  /** In teams A and B, so sees the issues of both */
  let author: TestUser;
  /** In team A only: reads the page, not on any sharing list */
  let reader: TestUser;
  /** In org A, not on team A: may read the org's public spaces, sees no project */
  let orgReader: TestUser;
  let stranger: TestUser;
  let spaceId: string;
  let dashboardId: string;
  let savedId: string;
  let otherDashboardId: string;
  let pageId: string;
  let number = 9000;

  const act = (user: TestUser, action: string, input: object) =>
    authPost('/api/act', user.token, { action, input });

  const done = async (user: TestUser, action: string, input: object) => {
    const res = await act(user, action, input);
    expect(res.status, `${action}: ${JSON.stringify(res.body)}`).toBe(200);
    return res.body;
  };

  const embedded = (user: TestUser, embedId: string, page = pageId) =>
    done(user, 'dashboard.renderEmbedded', { pageId: page, embedId }) as Promise<{
      widgets: EmbeddedWidget[];
      projectIds: string[];
    }>;

  const addIssue = (ctx: TestContext) =>
    prisma.issue.create({
      data: {
        projectId: ctx.projectId,
        number: number++,
        title: `Issue ${MARK}`,
        body: '',
        creatorId: ctx.owner.id,
      },
    });

  let slug = 0;
  const addPage = async (body: string) =>
    (
      await prisma.page.create({
        data: { spaceId, title: `P${slug}`, slug: `p-${MARK}-${slug++}`, body },
      })
    ).id;

  beforeAll(async () => {
    a = await createTestContext(`emba${Date.now()}`);
    b = await createTestContext(`embb${Date.now()}`);
    await Promise.all([addIssue(a), addIssue(a), addIssue(b), addIssue(b), addIssue(b)]);

    author = await addMemberToContext(a);
    await prisma.teamMembership.create({
      data: { teamId: b.teamId, userId: author.id, role: 'MEMBER' },
    });
    reader = await addMemberToContext(a);
    orgReader = await createTestUser();
    await prisma.orgMembership.create({
      data: { orgId: a.orgId, userId: orgReader.id, role: 'MEMBER' },
    });
    stranger = b.owner;

    spaceId = (
      await prisma.wikiSpace.create({
        data: { teamId: a.teamId, name: 'Embeds', slug: `embeds-${MARK}` },
      })
    ).id;

    dashboardId = (await done(author, 'dashboard.create', { name: `Secret name ${MARK}` })).id;
    await done(author, 'dashboardWidget.add', {
      id: dashboardId,
      type: 'COUNT',
      title: 'Marked',
      query: COUNTING,
    });
    savedId = (await done(author, 'savedQuery.create', { name: `Private ${MARK}`, text: COUNTING }))
      .id;
    await done(author, 'dashboardWidget.add', {
      id: dashboardId,
      type: 'COUNT',
      title: 'From a saved query',
      savedQueryId: savedId,
    });
    otherDashboardId = (await done(author, 'dashboard.create', { name: 'Not embedded' })).id;

    pageId = await addPage(
      [
        '# Page',
        `:::query dashboard:${dashboardId}:::`,
        `:::query ${savedId}:::`,
        `:::query inline:${JSON.stringify(`${COUNTING} GROUP BY project`)}:::`,
      ].join('\n\n'),
    );
  });

  afterAll(async () => {
    await prisma.dashboard.deleteMany({ where: { ownerId: author.id } });
    await prisma.savedFilter.deleteMany({ where: { userId: author.id } });
    await prisma.wikiSpace.deleteMany({ where: { teamId: a.teamId } });
    await cleanupTestContext(a);
    await cleanupTestContext(b);
    await prisma.user.deleteMany({
      where: { id: { in: [author, reader, orgReader].map((u) => u.id) } },
    });
  });

  describe('a reader who cannot open the dashboard', () => {
    it('cannot open it directly', async () => {
      const res = await act(reader, 'dashboard.render', { id: dashboardId });
      expect(res.status).toBe(404);
    });

    it('sees it with their own numbers, its author with theirs', async () => {
      const mine = await embedded(author, `dashboard:${dashboardId}`);
      const theirs = await embedded(reader, `dashboard:${dashboardId}`);
      expect(mine.widgets[0].result.total).toBe(5);
      expect(theirs.widgets[0].result.total).toBe(2);
      expect(theirs.widgets[0].title).toBe('Marked');
      expect(theirs.projectIds).toEqual([a.projectId]);
    });

    it('sees a widget that reads a saved query they cannot open', async () => {
      const { widgets } = await embedded(reader, `dashboard:${dashboardId}`);
      expect(widgets[1].result.total).toBe(2);
    });

    it('sees an embedded saved query with their own results', async () => {
      const mine = await embedded(author, savedId);
      const theirs = await embedded(reader, savedId);
      expect(mine.widgets[0].result.items).toHaveLength(5);
      expect(theirs.widgets[0].result.items).toHaveLength(2);
    });

    it('sees an inline query with their own results', async () => {
      const embedId = `inline:${JSON.stringify(`${COUNTING} GROUP BY project`)}`;
      const { widgets } = await embedded(reader, embedId);
      expect(widgets[0].result.groups?.map((g) => g.count)).toEqual([2]);
    });

    it('sees nothing of a project outside their teams, only an empty result', async () => {
      const space = await prisma.wikiSpace.create({
        data: {
          teamId: a.teamId,
          name: 'Open',
          slug: `open-${MARK}`,
          permissions: { create: { userId: orgReader.id, level: 'VIEW' } },
        },
      });
      const page = await prisma.page.create({
        data: {
          spaceId: space.id,
          title: 'Open',
          slug: 'open',
          body: `:::query dashboard:${dashboardId}:::`,
        },
      });
      const { widgets, projectIds } = await embedded(
        orgReader,
        `dashboard:${dashboardId}`,
        page.id,
      );
      expect(widgets[0].result.total).toBe(0);
      expect(projectIds).toEqual([]);
    });
  });

  describe('what it says about what it embeds', () => {
    it.each([
      ['a dashboard', () => `dashboard:${dashboardId}`],
      ['a saved query', () => savedId],
    ])('gives no query text, name, owner or sharing of %s', async (_name, embedId) => {
      const body = await embedded(reader, embedId());
      const text = JSON.stringify(body);
      for (const secret of [COUNTING, 'Secret name', 'Private']) {
        expect(text).not.toContain(secret);
      }
      for (const word of [
        'ownerId',
        'userId',
        'visibility',
        'teamId',
        'orgId',
        'canEdit',
        'query',
        'savedQueryId',
        'description',
      ]) {
        expect(text).not.toContain(`"${word}"`);
      }
      expect(Object.keys(body).sort()).toEqual(['projectIds', 'widgets']);
      for (const widget of body.widgets) {
        expect(Object.keys(widget).sort()).toEqual(['id', 'result', 'title', 'type']);
      }
    });

    it('keeps the query text out of the error of a query that fails', async () => {
      const secret = `nosuchfield${MARK}`;
      const board = (await done(author, 'dashboard.create', { name: 'Fails' })).id;
      const widget = await done(author, 'dashboardWidget.add', {
        id: board,
        type: 'COUNT',
        title: 'Fine so far',
        query: COUNTING,
      });
      // Written straight to the row: the write itself refuses a query that does not parse
      await prisma.dashboardWidget.update({
        where: { id: widget.id },
        data: { query: `${secret} = 1 AND (` },
      });
      const saved = (await done(author, 'savedQuery.create', { name: 'Fails', text: COUNTING })).id;
      await prisma.savedFilter.update({
        where: { id: saved },
        data: { query: { kind: 'query', text: `${secret} = 1 AND (` } },
      });
      const page = await addPage(`:::query dashboard:${board}:::\n\n:::query ${saved}:::`);

      for (const embedId of [`dashboard:${board}`, saved]) {
        const body = await embedded(reader, embedId, page);
        expect(body.widgets[0].result.error?.code).toBe('INVALID_QUERY');
        expect(JSON.stringify(body)).not.toContain(secret);
      }
    });

    it('says what is wrong with an inline query, which the page shows anyway', async () => {
      const embedId = 'inline:"nosuchfield = 1"';
      const page = await addPage(`:::query ${embedId}:::`);
      const { widgets } = await embedded(reader, embedId, page);
      expect(widgets[0].result.error?.code).toBe('INVALID_QUERY');
      expect(widgets[0].result.error?.message).toContain('nosuchfield');
    });
  });

  describe('when it answers', () => {
    it('refuses what is not in the page: another dashboard, another query', async () => {
      for (const embedId of [
        `dashboard:${otherDashboardId}`,
        'inline:"type = Bug"',
        'cm1notthere',
      ]) {
        const res = await act(reader, 'dashboard.renderEmbedded', { pageId, embedId });
        expect(res.status, embedId).toBe(404);
      }
    });

    it('does not count an embed in a code block, or the same text in a paragraph', async () => {
      const page = await addPage(
        [
          '```',
          `:::query dashboard:${otherDashboardId}:::`,
          '```',
          '',
          `text :::query ${savedId}:::`,
        ].join('\n'),
      );
      for (const embedId of [`dashboard:${otherDashboardId}`, savedId]) {
        const res = await act(reader, 'dashboard.renderEmbedded', { pageId: page, embedId });
        expect(res.status, embedId).toBe(404);
      }
    });

    it('goes by the current body: an embed taken out stops working', async () => {
      const page = await addPage(`:::query dashboard:${dashboardId}:::`);
      await embedded(reader, `dashboard:${dashboardId}`, page);
      await prisma.page.update({ where: { id: page }, data: { body: 'Gone' } });
      const res = await act(reader, 'dashboard.renderEmbedded', {
        pageId: page,
        embedId: `dashboard:${dashboardId}`,
      });
      expect(res.status).toBe(404);
    });

    it('answers a page the caller cannot read like one that does not exist', async () => {
      const embedId = `dashboard:${dashboardId}`;
      const hidden = await act(stranger, 'dashboard.renderEmbedded', { pageId, embedId });
      const missing = await act(stranger, 'dashboard.renderEmbedded', {
        pageId: 'cm1nosuchpage',
        embedId,
      });
      expect(hidden.status).toBe(404);
      expect(missing.status).toBe(404);
      expect(hidden.body).toEqual(missing.body);
    });

    it('respects a page restriction: a viewer left out gets the same 404', async () => {
      const page = await addPage(`:::query dashboard:${dashboardId}:::`);
      await prisma.pageRestriction.create({
        data: { pageId: page, userId: author.id, type: 'VIEW' },
      });
      await embedded(author, `dashboard:${dashboardId}`, page);
      const res = await act(reader, 'dashboard.renderEmbedded', {
        pageId: page,
        embedId: `dashboard:${dashboardId}`,
      });
      expect(res.status).toBe(404);
    });

    it('answers 404 for a dashboard that was deleted', async () => {
      const gone = (await done(author, 'dashboard.create', { name: 'Goes' })).id;
      const page = await addPage(`:::query dashboard:${gone}:::`);
      await done(author, 'dashboard.delete', { id: gone });
      const res = await act(reader, 'dashboard.renderEmbedded', {
        pageId: page,
        embedId: `dashboard:${gone}`,
      });
      expect(res.status).toBe(404);
    });

    it('is reachable over REST as well', async () => {
      const res = await authPost('/api/dashboards/embedded', reader.token, {
        pageId,
        embedId: `dashboard:${dashboardId}`,
      });
      expect(res.status).toBe(200);
      expect(res.body.widgets[0].result.total).toBe(2);
    });
  });

  describe('limits', () => {
    it('takes one read slot, and answers busy when none is free', async () => {
      const user = await addMemberToContext(a);
      let release = () => {};
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const refused = new AppError(500, 'no free slot in the test');
      const running = Array.from({ length: READ_CONCURRENCY.perUser }, () =>
        readSlots.run(user.id, refused, () => held),
      );
      const res = await act(user, 'dashboard.renderEmbedded', {
        pageId,
        embedId: `dashboard:${dashboardId}`,
      });
      release();
      await Promise.all(running);
      expect(res.status).toBe(429);
    });

    it('shares the limit of dashboard renders, whichever of the three it is', async () => {
      const user = await addMemberToContext(a);
      const embedId = `inline:${JSON.stringify(`${COUNTING} GROUP BY project`)}`;
      const statuses: number[] = [];
      for (let i = 0; i <= RENDER_LIMIT.max; i++) {
        statuses.push((await act(user, 'dashboard.renderEmbedded', { pageId, embedId })).status);
      }
      expect(statuses.slice(0, RENDER_LIMIT.max).every((status) => status === 200)).toBe(true);
      expect(statuses[RENDER_LIMIT.max]).toBe(429);
    });

    it('refuses an inline query past what query.run takes', async () => {
      const embedId = `inline:${JSON.stringify('x'.repeat(1001))}`;
      const page = await addPage(`:::query ${embedId}:::`);
      const res = await act(reader, 'dashboard.renderEmbedded', { pageId: page, embedId });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_QUERY');
    });
  });

  describe('tokens', () => {
    const viaToken = async (scopes: string[], embedId: string) => {
      return request(app)
        .post('/api/act')
        .set('Authorization', await tokenHeaderFor(reader, scopes))
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ action: 'dashboard.renderEmbedded', input: { pageId, embedId } });
    };

    it('needs dashboards:read', async () => {
      const res = await viaToken(['wiki:read', 'issues:read'], `dashboard:${dashboardId}`);
      expect(res.status).toBe(403);
    });

    it('needs wiki:read: the page is what it reads to answer', async () => {
      const res = await viaToken(['dashboards:read', 'issues:read'], `dashboard:${dashboardId}`);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('SCOPE');
    });

    it('gives a query widget a SCOPE error without issues:read', async () => {
      const res = await viaToken(['dashboards:read', 'wiki:read'], `dashboard:${dashboardId}`);
      expect(res.status).toBe(200);
      expect(res.body.widgets[0].result.error.code).toBe('SCOPE');
    });

    it('renders with all three', async () => {
      const res = await viaToken(
        ['dashboards:read', 'wiki:read', 'issues:read'],
        `dashboard:${dashboardId}`,
      );
      expect(res.status).toBe(200);
      expect(res.body.widgets[0].result.total).toBe(2);
    });
  });
});
