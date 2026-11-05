/**
 * Dashboards: who sees and changes them, and that rendering one shows each viewer what they can
 * see, widget by widget.
 */
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

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
import * as queryService from '../search/query.service';

import { mapWithCap, RENDER_LIMIT, WIDGETS_AT_ONCE } from './dashboards.service';

const MARK = `dash${Date.now()}`;
const COUNTING = `title ~ ${MARK}`;

interface RenderedWidget {
  id: string;
  type: string;
  title: string;
  result: {
    error?: { message: string; code?: string };
    kind?: string;
    total?: number;
    items?: unknown[];
    groups?: unknown[];
    sprints?: Array<{ id: string }>;
  };
}

interface Rendered {
  dashboard: { id: string; name: string; canEdit: boolean };
  widgets: RenderedWidget[];
  projectIds: string[];
}

describe('dashboards', () => {
  let a: TestContext;
  let b: TestContext;
  /** In team A and in project B's team, so sees more than anyone else */
  let creator: TestUser;
  /** In team A only */
  let teamMember: TestUser;
  let teamAdmin: TestUser;
  /** In org A, not on team A */
  let orgOnly: TestUser;
  let orgAdmin: TestUser;
  /** Only in org B */
  let stranger: TestUser;
  let platformAdmin: TestUser;
  let sprintA: string;
  let sprintB: string;
  let number = 9000;

  const act = async (user: TestUser, action: string, input: object) => {
    const res = await authPost('/api/act', user.token, { action, input });
    return res;
  };

  const done = async (user: TestUser, action: string, input: object) => {
    const res = await act(user, action, input);
    expect(res.status, `${action}: ${JSON.stringify(res.body)}`).toBe(200);
    return res.body;
  };

  const newDashboard = async (input: object = {}, user: TestUser = creator): Promise<string> =>
    (await done(user, 'dashboard.create', { name: 'Board', ...input })).id;

  const addWidget = async (
    dashboardId: string,
    input: object,
    user: TestUser = creator,
  ): Promise<string> =>
    (await done(user, 'dashboardWidget.add', { id: dashboardId, title: 'Widget', ...input })).id;

  const render = async (id: string, user: TestUser): Promise<Rendered> =>
    done(user, 'dashboard.render', { id });

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

  const addSprint = async (ctx: TestContext) =>
    (
      await prisma.sprint.create({
        data: {
          projectId: ctx.projectId,
          name: `Sprint ${MARK}`,
          status: 'ACTIVE',
          startDate: new Date(Date.now() - 86_400_000),
          endDate: new Date(Date.now() + 86_400_000),
        },
      })
    ).id;

  const countOf = (widget: RenderedWidget | undefined) => widget?.result.total;
  const sprintsOf = (widget: RenderedWidget | undefined) =>
    widget?.result.sprints?.map((s) => s.id).filter((id) => [sprintA, sprintB].includes(id));

  beforeAll(async () => {
    a = await createTestContext(`dba${Date.now()}`);
    b = await createTestContext(`dbb${Date.now()}`);
    await Promise.all([addIssue(a), addIssue(a), addIssue(b), addIssue(b), addIssue(b)]);
    sprintA = await addSprint(a);
    sprintB = await addSprint(b);

    creator = await addMemberToContext(a);
    teamMember = await addMemberToContext(a);
    teamAdmin = await addMemberToContext(a);
    await prisma.teamMembership.update({
      where: { userId_teamId: { userId: teamAdmin.id, teamId: a.teamId } },
      data: { role: 'ADMIN' },
    });
    orgOnly = await createTestUser();
    await prisma.orgMembership.create({
      data: { orgId: a.orgId, userId: orgOnly.id, role: 'MEMBER' },
    });
    orgAdmin = await createTestUser();
    await prisma.orgMembership.create({
      data: { orgId: a.orgId, userId: orgAdmin.id, role: 'ADMIN' },
    });
    stranger = b.owner;
    platformAdmin = await createTestUser();
    await prisma.user.update({ where: { id: platformAdmin.id }, data: { isAdmin: true } });
    await prisma.teamMembership.create({
      data: { teamId: b.teamId, userId: creator.id, role: 'MEMBER' },
    });
  });

  afterAll(async () => {
    await cleanupTestContext(a);
    await cleanupTestContext(b);
    await prisma.user.deleteMany({
      where: {
        id: {
          in: [creator, teamMember, teamAdmin, orgOnly, orgAdmin, platformAdmin].map((u) => u.id),
        },
      },
    });
  });

  describe('rendering with the viewer rights', () => {
    let shared: string;
    let count: string;
    let overview: string;

    beforeAll(async () => {
      shared = await newDashboard({ visibility: 'TEAM', teamId: a.teamId });
      count = await addWidget(shared, { type: 'COUNT', query: COUNTING, title: 'Issues' });
      overview = await addWidget(shared, { type: 'SPRINT_OVERVIEW', title: 'Sprints' });
    });

    it('gives two users their own numbers from one dashboard', async () => {
      const mine = await render(shared, creator);
      const theirs = await render(shared, teamMember);

      expect(mine.widgets.map((w) => w.id)).toEqual([count, overview]);
      expect(mine.widgets.map((w) => [w.type, w.title])).toEqual([
        ['COUNT', 'Issues'],
        ['SPRINT_OVERVIEW', 'Sprints'],
      ]);
      expect(countOf(mine.widgets[0])).toBe(5);
      expect(countOf(theirs.widgets[0])).toBe(2);
      expect(sprintsOf(mine.widgets[1])?.sort()).toEqual([sprintA, sprintB].sort());
      expect(sprintsOf(theirs.widgets[1])).toEqual([sprintA]);
    });

    it('names only the projects the viewer can see', async () => {
      const mine = await render(shared, creator);
      const theirs = await render(shared, teamMember);
      expect(mine.projectIds).toEqual(expect.arrayContaining([a.projectId, b.projectId]));
      expect(theirs.projectIds).toContain(a.projectId);
      expect(theirs.projectIds).not.toContain(b.projectId);
    });

    it('tells the viewer whether they may change it', async () => {
      expect((await render(shared, creator)).dashboard.canEdit).toBe(true);
      expect((await render(shared, teamMember)).dashboard.canEdit).toBe(false);
    });
  });

  describe('a widget that fails', () => {
    it('returns its error and the other widgets still render', async () => {
      const id = await newDashboard();
      await addWidget(id, { type: 'COUNT', query: 'nosuchfield = 1', title: 'Broken' });
      const good = await addWidget(id, { type: 'COUNT', query: COUNTING, title: 'Good' });
      const { widgets } = await render(id, creator);
      expect(widgets[0].result.error?.message).toMatch(/nosuchfield/i);
      expect(widgets[0].result.total).toBeUndefined();
      expect(widgets[1].id).toBe(good);
      expect(countOf(widgets[1])).toBe(5);
    });

    it('gives a viewer who cannot open the saved query an error, not its data', async () => {
      const privateQuery = (
        await authPost('/api/saved-filters', creator.token, {
          name: 'Mine',
          text: `SELECT COUNT WHERE ${COUNTING}`,
        })
      ).body.id as string;
      const id = await newDashboard({ visibility: 'TEAM', teamId: a.teamId });
      await addWidget(id, { type: 'COUNT', savedQueryId: privateQuery, title: 'Saved' });
      await addWidget(id, { type: 'COUNT', query: COUNTING, title: 'Inline' });

      const mine = await render(id, creator);
      expect(countOf(mine.widgets[0])).toBe(5);

      const theirs = await render(id, teamMember);
      expect(theirs.widgets[0].result.error?.message).toMatch(/not found/i);
      expect(theirs.widgets[0].result).not.toHaveProperty('total');
      expect(theirs.widgets[0].result).not.toHaveProperty('groups');
      expect(countOf(theirs.widgets[1])).toBe(2);
    });

    it('stops answering for a saved query once the viewer leaves its team', async () => {
      const leaver = await addMemberToContext(a);
      const teamQuery = (
        await authPost('/api/saved-filters', creator.token, {
          name: 'Team',
          text: `SELECT COUNT WHERE ${COUNTING}`,
          visibility: 'TEAM',
          teamId: a.teamId,
        })
      ).body.id as string;
      const id = await newDashboard({ visibility: 'ORG', orgId: a.orgId });
      await addWidget(id, { type: 'COUNT', savedQueryId: teamQuery });
      expect(countOf((await render(id, leaver)).widgets[0])).toBe(2);

      await prisma.teamMembership.delete({
        where: { userId_teamId: { userId: leaver.id, teamId: a.teamId } },
      });
      const after = await render(id, leaver);
      expect(after.widgets[0].result.error).toBeDefined();
      expect(after.widgets[0].result).not.toHaveProperty('total');
      await prisma.user.delete({ where: { id: leaver.id } });
    });

    it('turns a deleted saved query into an error on that widget', async () => {
      const query = (
        await authPost('/api/saved-filters', creator.token, { name: 'Gone', text: COUNTING })
      ).body.id as string;
      const id = await newDashboard();
      await addWidget(id, { type: 'COUNT', savedQueryId: query });
      await done(creator, 'savedQuery.delete', { filterId: query });
      const { widgets } = await render(id, creator);
      expect(widgets).toHaveLength(1);
      expect(widgets[0].result.error).toBeDefined();
    });

    it('turns a UI filter with no exact query into an error on that widget', async () => {
      const preset = (
        await authPost('/api/saved-filters', creator.token, {
          name: 'Preset',
          query: { search: 'something' },
        })
      ).body.id as string;
      const id = await newDashboard();
      await addWidget(id, { type: 'COUNT', savedQueryId: preset });
      const { widgets } = await render(id, creator);
      expect(widgets[0].result.error?.code).toBe('LEGACY_FILTER');
    });

    it('refuses a bar chart of a query without groups, at render', async () => {
      const id = await newDashboard();
      await addWidget(id, { type: 'BAR', query: COUNTING });
      const { widgets } = await render(id, creator);
      expect(widgets[0].result.error?.message).toMatch(/GROUP BY/);
    });
  });

  describe('what each widget type returns', () => {
    it('counts a plain query, and one with its own clauses', async () => {
      const id = await newDashboard();
      await addWidget(id, { type: 'COUNT', query: COUNTING });
      await addWidget(id, { type: 'COUNT', query: `${COUNTING} ORDER BY created DESC` });
      await addWidget(id, { type: 'COUNT', query: `SELECT COUNT WHERE ${COUNTING}` });
      await addWidget(id, { type: 'COUNT', query: `WHERE ${COUNTING} GROUP BY project` });
      const { widgets } = await render(id, creator);
      expect(widgets.map(countOf)).toEqual([5, 5, 5, 5]);
    });

    it('lists items for a table and a list, up to the limit in its options', async () => {
      const id = await newDashboard();
      await addWidget(id, { type: 'TABLE', query: COUNTING, options: { limit: 3 } });
      await addWidget(id, { type: 'LIST', query: COUNTING });
      const { widgets } = await render(id, creator);
      expect(widgets[0].result.kind).toBe('items');
      expect(widgets[0].result.items).toHaveLength(3);
      expect(widgets[1].result.items).toHaveLength(5);
    });

    it('groups for a bar chart', async () => {
      const id = await newDashboard();
      await addWidget(id, { type: 'BAR', query: `WHERE ${COUNTING} GROUP BY project` });
      const { widgets } = await render(id, creator);
      expect(widgets[0].result.kind).toBe('groups');
      expect(widgets[0].result.groups).toHaveLength(2);
    });

    it('narrows a sprint overview by its options', async () => {
      const id = await newDashboard();
      await addWidget(id, {
        type: 'SPRINT_OVERVIEW',
        options: { scope: { projectId: b.projectId } },
      });
      const { widgets, projectIds } = await render(id, creator);
      expect(sprintsOf(widgets[0])).toEqual([sprintB]);
      expect(projectIds).toEqual([b.projectId]);
    });
  });

  describe('the projects a render names', () => {
    it('are those of the scopes when every widget has one', async () => {
      const query = (
        await authPost('/api/saved-filters', creator.token, {
          name: 'Project A',
          text: COUNTING,
          projectId: a.projectId,
        })
      ).body.id as string;
      const id = await newDashboard();
      await addWidget(id, { type: 'COUNT', savedQueryId: query });
      const { widgets, projectIds } = await render(id, creator);
      expect(countOf(widgets[0])).toBe(2);
      expect(projectIds).toEqual([a.projectId]);
    });

    it('leave out a scope the viewer cannot see, which counts nothing', async () => {
      const id = await newDashboard({ visibility: 'ORG', orgId: a.orgId });
      await addWidget(id, {
        type: 'COUNT',
        query: COUNTING,
        options: { scope: { projectId: b.projectId } },
      });
      const { widgets, projectIds } = await render(id, teamMember);
      expect(countOf(widgets[0])).toBe(0);
      expect(projectIds).toEqual([]);
    });

    it('leave out what only a failed widget would have named', async () => {
      const id = await newDashboard();
      await addWidget(id, {
        type: 'COUNT',
        query: 'nosuchfield = 1',
        options: { scope: { projectId: a.projectId } },
      });
      expect((await render(id, creator)).projectIds).toEqual([]);
    });
  });

  describe('sharing', () => {
    let priv: string;
    let team: string;
    let org: string;

    beforeAll(async () => {
      priv = await newDashboard({ name: 'Private' });
      team = await newDashboard({ name: 'Team', visibility: 'TEAM', teamId: a.teamId });
      org = await newDashboard({ name: 'Org', visibility: 'ORG', orgId: a.orgId });
    });

    const seen = async (user: TestUser) => {
      const list = await done(user, 'dashboard.list', {});
      const ids: string[] = list.map((r: { id: string }) => r.id);
      const opens = await Promise.all(
        [priv, team, org].map(async (id) => (await act(user, 'dashboard.get', { id })).status),
      );
      const renders = await Promise.all(
        [priv, team, org].map(async (id) => (await act(user, 'dashboard.render', { id })).status),
      );
      return { listed: [priv, team, org].map((id) => ids.includes(id)), opens, renders };
    };

    it('shows the creator everything they made', async () => {
      expect(await seen(creator)).toEqual({
        listed: [true, true, true],
        opens: [200, 200, 200],
        renders: [200, 200, 200],
      });
    });

    it('shows a team member the team and org ones', async () => {
      expect(await seen(teamMember)).toEqual({
        listed: [false, true, true],
        opens: [404, 200, 200],
        renders: [404, 200, 200],
      });
    });

    it('shows an org member off the team only the org one', async () => {
      expect(await seen(orgOnly)).toEqual({
        listed: [false, false, true],
        opens: [404, 404, 200],
        renders: [404, 404, 200],
      });
    });

    it('answers a stranger as if none exist', async () => {
      expect(await seen(stranger)).toEqual({
        listed: [false, false, false],
        opens: [404, 404, 404],
        renders: [404, 404, 404],
      });
    });

    it('lets a platform admin open any by id, without listing them', async () => {
      expect(await seen(platformAdmin)).toEqual({
        listed: [false, false, false],
        opens: [200, 200, 200],
        renders: [200, 200, 200],
      });
    });

    it('stops showing a team one to someone removed from the team', async () => {
      const leaver = await addMemberToContext(a);
      expect((await act(leaver, 'dashboard.get', { id: team })).status).toBe(200);
      await prisma.teamMembership.delete({
        where: { userId_teamId: { userId: leaver.id, teamId: a.teamId } },
      });
      expect((await act(leaver, 'dashboard.get', { id: team })).status).toBe(404);
      await prisma.user.delete({ where: { id: leaver.id } });
    });

    it('needs membership to share with a team or org', async () => {
      const toTeam = await act(stranger, 'dashboard.create', {
        name: 'X',
        visibility: 'TEAM',
        teamId: a.teamId,
      });
      expect(toTeam.status).toBe(404);
      const toOrg = await act(stranger, 'dashboard.create', {
        name: 'X',
        visibility: 'ORG',
        orgId: a.orgId,
      });
      expect(toOrg.status).toBe(404);
      const noTeam = await act(creator, 'dashboard.create', { name: 'X', visibility: 'TEAM' });
      expect(noTeam.status).toBe(400);
      const move = await act(creator, 'dashboard.update', { id: priv, teamId: a.teamId });
      expect(move.status).toBe(400);
    });

    it('needs membership to move one to a team', async () => {
      const own = await newDashboard({}, stranger);
      const moved = await act(stranger, 'dashboard.update', {
        id: own,
        visibility: 'TEAM',
        teamId: a.teamId,
      });
      expect(moved.status).toBe(404);
    });
  });

  describe('edit rights', () => {
    const statusOf = async (user: TestUser, id: string) =>
      (await act(user, 'dashboard.update', { id, name: 'Renamed' })).status;

    it('on a team dashboard: creator, team admin and platform admin; a member is refused', async () => {
      const id = await newDashboard({ visibility: 'TEAM', teamId: a.teamId });
      expect(await statusOf(creator, id)).toBe(200);
      expect(await statusOf(teamAdmin, id)).toBe(200);
      expect(await statusOf(platformAdmin, id)).toBe(200);
      expect(await statusOf(teamMember, id)).toBe(403);
      expect(await statusOf(orgAdmin, id)).toBe(404);
      expect(await statusOf(stranger, id)).toBe(404);
    });

    it('on an org dashboard: creator, org owner and admin; a member is refused', async () => {
      const id = await newDashboard({ visibility: 'ORG', orgId: a.orgId });
      expect(await statusOf(creator, id)).toBe(200);
      expect(await statusOf(orgAdmin, id)).toBe(200);
      expect(await statusOf(a.owner, id)).toBe(200);
      expect(await statusOf(orgOnly, id)).toBe(403);
      expect(await statusOf(stranger, id)).toBe(404);
    });

    it('holds for delete and every widget write', async () => {
      const id = await newDashboard({ visibility: 'TEAM', teamId: a.teamId });
      const widget = await addWidget(id, { type: 'COUNT', query: COUNTING });
      const writes: Array<[string, object]> = [
        ['dashboard.delete', { id }],
        ['dashboardWidget.add', { id, type: 'COUNT', query: COUNTING, title: 'X' }],
        ['dashboardWidget.update', { id, widgetId: widget, title: 'X' }],
        ['dashboardWidget.remove', { id, widgetId: widget }],
        ['dashboardWidget.reorder', { id, widgetIds: [widget] }],
      ];
      for (const [action, input] of writes) {
        expect((await act(teamMember, action, input)).status, action).toBe(403);
        expect((await act(stranger, action, input)).status, action).toBe(404);
      }
      expect((await act(teamAdmin, 'dashboardWidget.update', writes[2][1])).status).toBe(200);
      expect((await act(creator, 'dashboard.delete', { id })).status).toBe(200);
      expect((await act(creator, 'dashboard.get', { id })).status).toBe(404);
    });

    it('answers a seen but not changeable dashboard 403 even with an invalid body', async () => {
      const id = await newDashboard({ visibility: 'TEAM', teamId: a.teamId });
      const res = await act(teamMember, 'dashboard.update', { id, name: '' });
      expect(res.status).toBe(403);
    });
  });

  describe('widgets', () => {
    it('take a saved query or an inline query, not both and not neither', async () => {
      const id = await newDashboard();
      const query = (
        await authPost('/api/saved-filters', creator.token, { name: 'Both', text: COUNTING })
      ).body.id as string;
      const add = (input: object) =>
        act(creator, 'dashboardWidget.add', { id, title: 'X', ...input });
      expect((await add({ type: 'COUNT' })).status).toBe(400);
      expect((await add({ type: 'COUNT', query: COUNTING, savedQueryId: query })).status).toBe(400);
      expect((await add({ type: 'SPRINT_OVERVIEW', query: COUNTING })).status).toBe(400);
      expect((await add({ type: 'COUNT', query: COUNTING })).status).toBe(200);
      expect((await add({ type: 'COUNT', savedQueryId: query })).status).toBe(200);
    });

    it('refuse a query that does not parse', async () => {
      const id = await newDashboard();
      const res = await act(creator, 'dashboardWidget.add', {
        id,
        title: 'X',
        type: 'COUNT',
        query: 'type = ',
      });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_QUERY');
    });

    it('refuse a saved query the user cannot open, like one that does not exist', async () => {
      const query = (
        await authPost('/api/saved-filters', creator.token, { name: 'Private', text: COUNTING })
      ).body.id as string;
      const id = await newDashboard({ visibility: 'TEAM', teamId: a.teamId }, teamAdmin);
      const add = (savedQueryId: string) =>
        act(teamAdmin, 'dashboardWidget.add', { id, title: 'X', type: 'COUNT', savedQueryId });
      expect((await add(query)).status).toBe(404);
      expect((await add('nothing-by-this-id')).status).toBe(404);

      const widget = await addWidget(id, { type: 'COUNT', query: COUNTING }, teamAdmin);
      const repoint = await act(teamAdmin, 'dashboardWidget.update', {
        id,
        widgetId: widget,
        savedQueryId: query,
        query: null,
      });
      expect(repoint.status).toBe(404);
    });

    it('change between a saved and an inline query, and keep one of them', async () => {
      const id = await newDashboard();
      const query = (
        await authPost('/api/saved-filters', creator.token, { name: 'Swap', text: COUNTING })
      ).body.id as string;
      const widget = await addWidget(id, { type: 'COUNT', query: COUNTING });
      const update = (input: object) =>
        act(creator, 'dashboardWidget.update', { id, widgetId: widget, ...input });

      expect((await update({ savedQueryId: query, query: null })).status).toBe(200);
      const got = await done(creator, 'dashboard.get', { id });
      expect(got.widgets[0]).toMatchObject({ savedQueryId: query, query: null });

      expect((await update({ query: 'type = ' })).status).toBe(400);
      expect((await update({ query: COUNTING })).status).toBe(400);
      expect((await update({ savedQueryId: null })).status).toBe(400);
      expect((await update({ type: 'SPRINT_OVERVIEW' })).status).toBe(400);
      expect(
        (await update({ type: 'SPRINT_OVERVIEW', savedQueryId: null, query: null })).status,
      ).toBe(200);
    });

    it('belong to their dashboard', async () => {
      const mine = await newDashboard();
      const other = await newDashboard();
      const widget = await addWidget(other, { type: 'COUNT', query: COUNTING });
      const update = await act(creator, 'dashboardWidget.update', {
        id: mine,
        widgetId: widget,
        title: 'X',
      });
      expect(update.status).toBe(404);
      const remove = await act(creator, 'dashboardWidget.remove', { id: mine, widgetId: widget });
      expect(remove.status).toBe(404);
      const reorder = await act(creator, 'dashboardWidget.reorder', {
        id: mine,
        widgetIds: [widget],
      });
      expect(reorder.status).toBe(400);
    });

    it('stop at 24 on a dashboard', async () => {
      const id = await newDashboard();
      await prisma.dashboardWidget.createMany({
        data: Array.from({ length: 24 }, (_, position) => ({
          dashboardId: id,
          type: 'COUNT' as const,
          title: `W${position}`,
          query: COUNTING,
          position,
        })),
      });
      const res = await act(creator, 'dashboardWidget.add', {
        id,
        title: 'One more',
        type: 'COUNT',
        query: COUNTING,
      });
      expect(res.status).toBe(400);
      expect(await prisma.dashboardWidget.count({ where: { dashboardId: id } })).toBe(24);
    });

    it('hold the cap when many are added at once', async () => {
      const id = await newDashboard();
      await prisma.dashboardWidget.createMany({
        data: Array.from({ length: 23 }, (_, position) => ({
          dashboardId: id,
          type: 'COUNT' as const,
          title: `W${position}`,
          query: COUNTING,
          position,
        })),
      });
      const answers = await Promise.all(
        Array.from({ length: 4 }, () =>
          act(creator, 'dashboardWidget.add', {
            id,
            title: 'Racing',
            type: 'COUNT',
            query: COUNTING,
          }),
        ),
      );
      expect(answers.map((r) => r.status).sort()).toEqual([200, 400, 400, 400]);
      expect(await prisma.dashboardWidget.count({ where: { dashboardId: id } })).toBe(24);
    });

    it('reorder, naming each widget once', async () => {
      const id = await newDashboard();
      const first = await addWidget(id, { type: 'COUNT', query: COUNTING, title: 'First' });
      const second = await addWidget(id, { type: 'COUNT', query: COUNTING, title: 'Second' });
      const third = await addWidget(id, { type: 'SPRINT_OVERVIEW', title: 'Third' });
      const reorder = (widgetIds: string[]) =>
        act(creator, 'dashboardWidget.reorder', { id, widgetIds });

      expect((await reorder([first, second])).status).toBe(400);
      expect((await reorder([first, first, second])).status).toBe(400);
      expect((await reorder([third, first, second])).status).toBe(200);
      const { widgets } = await render(id, creator);
      expect(widgets.map((w) => w.id)).toEqual([third, first, second]);
    });

    it('go, and the rest keep their order', async () => {
      const id = await newDashboard();
      const first = await addWidget(id, { type: 'COUNT', query: COUNTING });
      const second = await addWidget(id, { type: 'COUNT', query: COUNTING });
      await done(creator, 'dashboardWidget.remove', { id, widgetId: first });
      const third = await addWidget(id, { type: 'COUNT', query: COUNTING });
      const { widgets } = await render(id, creator);
      expect(widgets.map((w) => w.id)).toEqual([second, third]);
    });
  });

  describe('scopes', () => {
    let id: string;
    const renderWith = async (scopes: string[]) =>
      request(app)
        .post('/api/act')
        .set('Authorization', await tokenHeaderFor(creator, scopes))
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ action: 'dashboard.render', input: { id } });

    beforeAll(async () => {
      id = await newDashboard();
      await addWidget(id, { type: 'COUNT', query: COUNTING });
      await addWidget(id, { type: 'SPRINT_OVERVIEW' });
    });

    it('needs dashboards:read to render at all', async () => {
      expect((await renderWith(['issues:read', 'sprints:read'])).status).toBe(403);
    });

    it('gives a widget without its scope an error and renders the rest', async () => {
      const onlyDashboards = await renderWith(['dashboards:read']);
      expect(onlyDashboards.status).toBe(200);
      expect(onlyDashboards.body.widgets.map((w: RenderedWidget) => w.result.error?.code)).toEqual([
        'SCOPE',
        'SCOPE',
      ]);
      expect(onlyDashboards.body.projectIds).toEqual([]);

      const issues = await renderWith(['dashboards:read', 'issues:read']);
      expect(issues.body.widgets[0].result.total).toBe(5);
      expect(issues.body.widgets[1].result.error.code).toBe('SCOPE');

      const sprints = await renderWith(['dashboards:read', 'sprints:read']);
      expect(sprints.body.widgets[0].result.error.code).toBe('SCOPE');
      expect(sprints.body.widgets[1].result.sprints.length).toBeGreaterThan(0);
    });

    it('needs dashboards:write to change one', async () => {
      const post = async (scopes: string[]) =>
        request(app)
          .post('/api/dashboards')
          .set('Authorization', await tokenHeaderFor(creator, scopes))
          .set('X-Requested-With', 'XMLHttpRequest')
          .send({ name: 'Agent' });
      expect((await post(['dashboards:read'])).status).toBe(403);
      expect((await post(['dashboards:write'])).status).toBe(201);
    });
  });

  describe('limits', () => {
    const member = () => addMemberToContext(a);
    const queryRun = (user: TestUser) =>
      authPost('/api/query', user.token, { query: 'GROUP BY status' });

    const fullDashboard = async (user: TestUser) => {
      const id = await newDashboard({}, user);
      await prisma.dashboardWidget.createMany({
        data: Array.from({ length: 24 }, (_, position) => ({
          dashboardId: id,
          type: 'COUNT' as const,
          title: `W${position}`,
          query: COUNTING,
          position,
        })),
      });
      return id;
    };

    it('runs 24 widgets on one read slot, past what the user could run apart', async () => {
      const user = await member();
      const id = await fullDashboard(user);
      let release = () => {};
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const refused = new AppError(500, 'no free slot in the test');
      // Leaves exactly one: the render takes it and its widgets must not ask for another
      const running = Array.from({ length: READ_CONCURRENCY.perUser - 1 }, () =>
        readSlots.run(user.id, refused, () => held),
      );
      const rendered = await act(user, 'dashboard.render', { id });
      release();
      await Promise.all(running);
      expect(rendered.status).toBe(200);
      expect(rendered.body.widgets).toHaveLength(24);
      expect(rendered.body.widgets.every((w: RenderedWidget) => !w.result.error)).toBe(true);
    });

    it('refuses the render when no read slot is free', async () => {
      const user = await member();
      const id = await newDashboard({}, user);
      let release = () => {};
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const refused = new AppError(500, 'no free slot in the test');
      const running = Array.from({ length: READ_CONCURRENCY.perUser }, () =>
        readSlots.run(user.id, refused, () => held),
      );
      const busy = await act(user, 'dashboard.render', { id });
      release();
      await Promise.all(running);
      expect(busy.status).toBe(429);
      expect(busy.body.error.code).toBe('RATE_LIMITED');
    });

    it('takes nothing of the search budget, for a whole render or per widget', async () => {
      const user = await member();
      const id = await fullDashboard(user);
      for (let i = 0; i < 2; i++) await render(id, user);
      expect((await queryRun(user)).status).toBe(200);
    });

    it('has a limit of its own per user', async () => {
      const user = await member();
      const id = await newDashboard({}, user);
      const answers = [];
      for (let i = 0; i <= RENDER_LIMIT.max; i++) {
        answers.push((await act(user, 'dashboard.render', { id })).status);
      }
      expect(answers.slice(0, RENDER_LIMIT.max).every((status) => status === 200)).toBe(true);
      expect(answers[RENDER_LIMIT.max]).toBe(429);
      // A live dashboard must not cut its viewer off from search
      expect((await queryRun(user)).status).toBe(200);
    });

    it('caps a real render at 4 widgets at once', async () => {
      const user = await member();
      const id = await fullDashboard(user);
      const original = queryService.runQueryInHeldSlot;
      let running = 0;
      let peak = 0;
      // Passes through to the real query, and only counts what overlaps
      const spy = vi
        .spyOn(queryService, 'runQueryInHeldSlot')
        .mockImplementation(async (...args) => {
          running++;
          peak = Math.max(peak, running);
          try {
            await new Promise((resolve) => setTimeout(resolve, 5));
            return await original(...args);
          } finally {
            running--;
          }
        });
      try {
        const { widgets } = await render(id, user);
        expect(widgets).toHaveLength(24);
        expect(widgets.every((w) => w.result.total === 2)).toBe(true);
      } finally {
        spy.mockRestore();
      }
      expect(peak).toBe(4);
    });

    it('loads the dashboard once in a render, also through authorization', async () => {
      const user = await member();
      const id = await newDashboard({}, user);
      const spy = vi.spyOn(prisma.dashboard, 'findUnique');
      try {
        await render(id, user);
        expect(spy).toHaveBeenCalledTimes(1);
      } finally {
        spy.mockRestore();
      }
    });

    it('runs at most 4 at once, and keeps the order', async () => {
      expect(WIDGETS_AT_ONCE).toBe(4);
      let running = 0;
      let highest = 0;
      const results = await mapWithCap(
        Array.from({ length: 13 }, (_, i) => i),
        WIDGETS_AT_ONCE,
        async (i) => {
          running++;
          highest = Math.max(highest, running);
          await new Promise((resolve) => setTimeout(resolve, (13 - i) % 4));
          running--;
          return i * 2;
        },
      );
      expect(highest).toBe(4);
      expect(results).toEqual(Array.from({ length: 13 }, (_, i) => i * 2));
    });
  });

  describe('over REST', () => {
    it('answers on the routes the frontend calls', async () => {
      const created = await authPost('/api/dashboards', creator.token, { name: 'Rest' });
      expect(created.status).toBe(201);
      const { id } = created.body;
      const widget = await authPost(`/api/dashboards/${id}/widgets`, creator.token, {
        type: 'COUNT',
        query: COUNTING,
        title: 'Rest',
      });
      expect(widget.status).toBe(201);
      const auth = (r: request.Test) =>
        r.set('Authorization', `Bearer ${creator.token}`).set('X-Requested-With', 'XMLHttpRequest');
      const rendered = await auth(request(app).get(`/api/dashboards/${id}/render`));
      expect(rendered.status).toBe(200);
      expect(rendered.body.widgets[0].result.total).toBe(5);
      expect((await auth(request(app).get('/api/dashboards'))).status).toBe(200);
      const removed = await auth(request(app).delete(`/api/dashboards/${id}`));
      expect(removed.status).toBe(204);
    });
  });
});
