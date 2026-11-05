/**
 * Saved queries: who sees, runs and changes them, and that a shared query runs with the viewer's
 * rights.
 */
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../../config/database';
import app from '../../index';
import {
  addMemberToContext,
  cleanupTestContext,
  createTestContext,
  createTestUser,
  type TestContext,
  type TestUser,
} from '../../test/factory';
import { authDel, authGet, authPatch, authPost } from '../../test/helpers';
import { tokenHeaderFor } from '../../test/mcp-client';

const MARK = `sq${Date.now()}`;

describe('saved queries', () => {
  let a: TestContext;
  let b: TestContext;
  /** In team A, owns the queries */
  let creator: TestUser;
  let teamMember: TestUser;
  let teamAdmin: TestUser;
  /** In org A, not on team A */
  let orgOnly: TestUser;
  let orgAdmin: TestUser;
  /** Only in org B */
  let stranger: TestUser;
  let platformAdmin: TestUser;
  let number = 9000;

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

  const create = async (body: object, user: TestUser = creator) => {
    const res = await authPost('/api/saved-filters', user.token, body);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.id as string;
  };

  const text = `SELECT COUNT WHERE title ~ ${MARK}`;

  beforeAll(async () => {
    a = await createTestContext(`sqa${Date.now()}`);
    b = await createTestContext(`sqb${Date.now()}`);
    await Promise.all([addIssue(a), addIssue(a), addIssue(b), addIssue(b), addIssue(b)]);

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
    // The creator also works in project B, so the same query counts more for them
    await prisma.teamMembership.create({
      data: { teamId: b.teamId, userId: creator.id, role: 'MEMBER' },
    });
  });

  afterAll(async () => {
    await prisma.savedFilter.deleteMany({
      where: { userId: { in: [creator, teamMember, teamAdmin, orgOnly].map((u) => u.id) } },
    });
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

  describe('visibility', () => {
    let priv: string;
    let team: string;
    let org: string;

    beforeAll(async () => {
      priv = await create({ name: 'Private', text });
      team = await create({ name: 'Team', text, visibility: 'TEAM', teamId: a.teamId });
      org = await create({ name: 'Org', text, visibility: 'ORG', orgId: a.orgId });
    });

    const seen = async (user: TestUser) => {
      const list = await authGet('/api/saved-filters', user.token);
      expect(list.status).toBe(200);
      const ids: string[] = list.body.map((r: { id: string }) => r.id);
      const gets = await Promise.all(
        [priv, team, org].map(
          async (id) => (await authGet(`/api/saved-filters/${id}`, user.token)).status,
        ),
      );
      return { listed: [priv, team, org].map((id) => ids.includes(id)), gets };
    };

    it('shows the creator everything they made', async () => {
      expect(await seen(creator)).toEqual({ listed: [true, true, true], gets: [200, 200, 200] });
    });

    it('shows a team member the team and org ones', async () => {
      expect(await seen(teamMember)).toEqual({
        listed: [false, true, true],
        gets: [404, 200, 200],
      });
    });

    it('shows an org member who is not on the team the org one only', async () => {
      expect(await seen(orgOnly)).toEqual({ listed: [false, false, true], gets: [404, 404, 200] });
    });

    it('shows another org nothing, as a 404', async () => {
      expect(await seen(stranger)).toEqual({
        listed: [false, false, false],
        gets: [404, 404, 404],
      });
    });

    it('lets a platform admin open any by id', async () => {
      expect((await seen(platformAdmin)).gets).toEqual([200, 200, 200]);
    });

    it('answers 404 for a user taken off the team', async () => {
      const left = await addMemberToContext(a);
      expect((await authGet(`/api/saved-filters/${team}`, left.token)).status).toBe(200);
      await prisma.teamMembership.delete({
        where: { userId_teamId: { userId: left.id, teamId: a.teamId } },
      });
      expect((await authGet(`/api/saved-filters/${team}`, left.token)).status).toBe(404);
      expect((await authPost(`/api/saved-filters/${team}/run`, left.token, {})).status).toBe(404);
      await prisma.user.delete({ where: { id: left.id } });
    });
  });

  describe('sharing needs membership', () => {
    it('refuses to share with a team the caller is not on, as a 404', async () => {
      const res = await authPost('/api/saved-filters', creator.token, {
        name: 'x',
        text,
        visibility: 'TEAM',
        teamId: (
          await prisma.team.create({
            data: { orgId: b.orgId, name: 'Closed', slug: `c${Date.now()}` },
          })
        ).id,
      });
      expect(res.status).toBe(404);
    });

    it('refuses to share with an org the caller is not in', async () => {
      const res = await authPost('/api/saved-filters', orgOnly.token, {
        name: 'x',
        text,
        visibility: 'ORG',
        orgId: b.orgId,
      });
      expect(res.status).toBe(404);
    });

    it('needs the team or org that the visibility names', async () => {
      expect(
        (
          await authPost('/api/saved-filters', creator.token, {
            name: 'x',
            text,
            visibility: 'TEAM',
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await authPost('/api/saved-filters', creator.token, {
            name: 'x',
            text,
            visibility: 'ORG',
          })
        ).status,
      ).toBe(400);
    });

    it('refuses to move a query to a team the caller is not on', async () => {
      const id = await create({ name: 'Mine', text });
      const res = await authPatch(`/api/saved-filters/${id}`, creator.token, {
        visibility: 'ORG',
        orgId: b.orgId,
      });
      expect(res.status).toBe(404);
    });

    it('rejects text that is not a query, and both query and text', async () => {
      const bad = await authPost('/api/saved-filters', creator.token, {
        name: 'x',
        text: 'type =',
      });
      expect(bad.status).toBe(400);
      expect(bad.body.error.code).toBe('INVALID_QUERY');
      const both = await authPost('/api/saved-filters', creator.token, {
        name: 'x',
        text,
        query: { type: 'BUG' },
      });
      expect(both.status).toBe(400);
    });
  });

  describe('edit rights', () => {
    const change = (id: string, user: TestUser) =>
      authPatch(`/api/saved-filters/${id}`, user.token, { name: `Renamed by ${user.username}` });

    it('lets the creator change and delete their own', async () => {
      const id = await create({ name: 'Own', text });
      expect((await change(id, creator)).status).toBe(200);
      expect((await authDel(`/api/saved-filters/${id}`, creator.token)).status).toBe(204);
    });

    it('lets a team admin change a TEAM query and a plain member not', async () => {
      const id = await create({ name: 'T', text, visibility: 'TEAM', teamId: a.teamId });
      const member = await change(id, teamMember);
      expect(member.status).toBe(403);
      expect((await authDel(`/api/saved-filters/${id}`, teamMember.token)).status).toBe(403);
      expect((await change(id, teamAdmin)).status).toBe(200);
      expect((await authDel(`/api/saved-filters/${id}`, teamAdmin.token)).status).toBe(204);
    });

    it('does not let a team admin change a private query of someone else, 404', async () => {
      const id = await create({ name: 'P', text });
      expect((await change(id, teamAdmin)).status).toBe(404);
    });

    it('lets an org owner or admin change an ORG query, and a member not', async () => {
      const id = await create({ name: 'O', text, visibility: 'ORG', orgId: a.orgId });
      expect((await change(id, teamMember)).status).toBe(403);
      expect((await change(id, orgOnly)).status).toBe(403);
      expect((await change(id, orgAdmin)).status).toBe(200);
    });

    it('lets a platform admin change any', async () => {
      const id = await create({ name: 'P2', text });
      expect((await change(id, platformAdmin)).status).toBe(200);
    });

    it('does not let a body rename the owner', async () => {
      const id = await create({ name: 'Own2', text });
      await authPatch(`/api/saved-filters/${id}`, creator.token, { userId: teamMember.id });
      expect((await prisma.savedFilter.findUniqueOrThrow({ where: { id } })).userId).toBe(
        creator.id,
      );
    });

    it('turns sharing off again', async () => {
      const id = await create({ name: 'Back', text, visibility: 'TEAM', teamId: a.teamId });
      const res = await authPatch(`/api/saved-filters/${id}`, creator.token, {
        visibility: 'PRIVATE',
      });
      expect(res.body).toMatchObject({ visibility: 'PRIVATE', teamId: null, orgId: null });
      expect((await authGet(`/api/saved-filters/${id}`, teamMember.token)).status).toBe(404);
    });

    it('says in the list whether the caller may change a query', async () => {
      const id = await create({ name: 'Flag', text, visibility: 'TEAM', teamId: a.teamId });
      const flag = async (user: TestUser) =>
        (await authGet('/api/saved-filters', user.token)).body.find(
          (r: { id: string }) => r.id === id,
        ).canEdit;
      expect([await flag(creator), await flag(teamAdmin), await flag(teamMember)]).toEqual([
        true,
        true,
        false,
      ]);
    });
  });

  describe('run', () => {
    it('runs with the rights of whoever runs it: different counts', async () => {
      const id = await create({ name: 'Counts', text, visibility: 'ORG', orgId: a.orgId });
      const count = async (user: TestUser) => {
        const res = await authPost(`/api/saved-filters/${id}/run`, user.token);
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        return res.body.groups[0].count as number;
      };
      // creator sees project A (2) and B (3), a team member only A, an org member without team none
      expect(await count(creator)).toBe(5);
      expect(await count(teamMember)).toBe(2);
      expect(await count(orgOnly)).toBe(0);
    });

    it('runs a query given as items and pages it', async () => {
      const id = await create({ name: 'Items', text: `title ~ ${MARK} ORDER BY number` });
      const first = await authPost(`/api/saved-filters/${id}/run`, creator.token, { limit: 2 });
      expect(first.body.items).toHaveLength(2);
      const next = await authPost(`/api/saved-filters/${id}/run`, creator.token, {
        limit: 2,
        cursor: first.body.nextCursor,
      });
      expect(next.body.items).toHaveLength(2);
    });

    it('narrows a query saved on a project to that project', async () => {
      const id = await create({ name: 'Scoped', text, projectId: b.projectId });
      const res = await authPost(`/api/saved-filters/${id}/run`, creator.token);
      expect(res.body.groups[0].count).toBe(3);
    });

    it('converts an old issue-list filter when nothing is lost, else answers 400', async () => {
      const ok = await create({ name: 'Old', query: { type: 'BUG,TASK' } });
      expect((await authPost(`/api/saved-filters/${ok}/run`, creator.token)).status).toBe(200);
      const lossy = await create({ name: 'Old2', query: { type: 'BUG', search: 'login' } });
      const res = await authPost(`/api/saved-filters/${lossy}/run`, creator.token);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('LEGACY_FILTER');
    });

    it('answers by name for the token rules: dashboards:read and issues:read both', async () => {
      const id = await create({ name: 'Tok', text, visibility: 'ORG', orgId: a.orgId });
      const run = async (scopes: string[]) =>
        request(app)
          .post(`/api/saved-filters/${id}/run`)
          .set('Authorization', await tokenHeaderFor(teamMember, scopes))
          .set('X-Requested-With', 'XMLHttpRequest');
      expect((await run(['dashboards:read'])).status).toBe(403);
      expect((await run(['issues:read'])).status).toBe(403);
      expect((await run(['dashboards:read', 'issues:read'])).status).toBe(200);
    });

    it('lets a token write saved queries only with dashboards:write', async () => {
      const post = async (scopes: string[]) =>
        request(app)
          .post('/api/saved-filters')
          .set('Authorization', await tokenHeaderFor(creator, scopes))
          .set('X-Requested-With', 'XMLHttpRequest')
          .send({ name: 'Agent', text });
      expect((await post(['dashboards:read'])).status).toBe(403);
      expect((await post(['dashboards:write'])).status).toBe(201);
    });
  });

  it('keeps the old record shape', async () => {
    const id = await create({ name: 'Shape', query: { type: 'BUG' } });
    const res = await authGet(`/api/saved-filters/${id}`, creator.token);
    expect(res.body).toMatchObject({
      id,
      userId: creator.id,
      projectId: null,
      name: 'Shape',
      query: { type: 'BUG' },
      visibility: 'PRIVATE',
    });
    expect(typeof res.body.createdAt).toBe('string');
  });

  describe('review fixes', () => {
    it('does not read a UI preset that has a text key as query text', async () => {
      const id = await create({ name: 'Preset', query: { text: `title ~ ${MARK}` } });
      const res = await authPost(`/api/saved-filters/${id}/run`, creator.token);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('LEGACY_FILTER');
    });

    it('refuses teamId or orgId without a visibility on update', async () => {
      const id = await create({ name: 'NoVis', text });
      const res = await authPatch(`/api/saved-filters/${id}`, creator.token, { teamId: a.teamId });
      expect(res.status).toBe(400);
    });

    it('lists the own queries first, so shared ones cannot push them out', async () => {
      const user = await createTestUser();
      await prisma.teamMembership.create({
        data: { teamId: a.teamId, userId: user.id, role: 'MEMBER' },
      });
      const mine = await create({ name: 'Old mine', text }, user);
      await prisma.savedFilter.update({
        where: { id: mine },
        data: { createdAt: new Date('2020-01-01') },
      });
      await prisma.savedFilter.createMany({
        data: Array.from({ length: 100 }, (_, i) => ({
          userId: creator.id,
          name: `Shared ${i}`,
          query: { kind: 'query', text },
          visibility: 'TEAM' as const,
          teamId: a.teamId,
        })),
      });
      const list = await authGet('/api/saved-filters', user.token);
      expect(list.body).toHaveLength(100);
      expect(list.body[0].id).toBe(mine);
      expect(list.body[0].canEdit).toBe(true);
      expect(list.body[1].canEdit).toBe(false);
      await prisma.user.delete({ where: { id: user.id } });
    });
  });
});
