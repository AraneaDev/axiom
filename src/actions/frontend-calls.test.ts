import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../config/database';
import app from '../index';

/**
 * The three frontend calls that parity.test.ts found pointing at routes with the wrong path,
 * method or body. Each runs here against the real route with the body the frontend sends, so a
 * call that matches on paper but is refused by the route's validation fails too.
 */
describe('frontend calls that once missed their route', () => {
  const slug = 'frontend-calls';
  let token: string;
  let ownerId: string;
  let projectId: string;
  let teamId: string;
  let spaceId: string;
  let outsiderId: string;
  let memberId: string;

  const as = (req: request.Test) =>
    req.set('Authorization', `Bearer ${token}`).set('X-Requested-With', 'XMLHttpRequest');

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash('testpassword123', 4);
    const owner = await prisma.user.create({
      data: {
        email: `${slug}-owner@axiom.dev`,
        username: `${slug}-owner`,
        displayName: 'Owner',
        passwordHash,
      },
    });
    const member = await prisma.user.create({
      data: {
        email: `${slug}-member@axiom.dev`,
        username: `${slug}-member`,
        displayName: 'Member',
        passwordHash,
      },
    });
    const outsider = await prisma.user.create({
      data: {
        email: `${slug}-outsider@axiom.dev`,
        username: `${slug}-outsider`,
        displayName: 'Outsider',
        passwordHash,
      },
    });
    ownerId = owner.id;
    memberId = member.id;
    outsiderId = outsider.id;
    const org = await prisma.organization.create({
      data: {
        name: 'Frontend Calls Org',
        slug: `${slug}-org`,
        members: {
          create: [
            { userId: owner.id, role: 'OWNER' },
            { userId: member.id, role: 'MEMBER' },
          ],
        },
      },
    });
    const team = await prisma.team.create({
      data: {
        name: 'Frontend Calls Team',
        slug: `${slug}-team`,
        orgId: org.id,
        members: { create: { userId: owner.id, role: 'ADMIN' } },
      },
    });
    teamId = team.id;
    const login = await request(app)
      .post('/api/auth/login')
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ login: `${slug}-owner@axiom.dev`, password: 'testpassword123' });
    token = login.body.accessToken;
    const project = await as(request(app).post(`/api/projects/team/${team.id}`)).send({
      name: 'Frontend Calls Project',
      slug: `${slug}-project`,
      prefix: 'FRC',
    });
    projectId = project.body.id;
    const space = await as(request(app).post(`/api/wiki/team/${teamId}/spaces`)).send({
      name: 'Frontend Calls Space',
      slug: `${slug}-space`,
    });
    spaceId = space.body.id;
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { slug: `${slug}-org` } });
    await prisma.user.deleteMany({ where: { username: { startsWith: slug } } });
  });

  it('reorders roadmap buckets with POST and bucketIds', async () => {
    const first = await as(request(app).post(`/api/projects/${projectId}/roadmap/buckets`)).send({
      name: 'First',
    });
    const second = await as(request(app).post(`/api/projects/${projectId}/roadmap/buckets`)).send({
      name: 'Second',
    });
    const orderedIds = [second.body.id, first.body.id];
    const res = await as(
      request(app).post(`/api/projects/${projectId}/roadmap/buckets/reorder`),
    ).send({ bucketIds: orderedIds });
    expect(res.status).toBe(200);
    expect(res.body.map((bucket: { id: string }) => bucket.id)).toEqual(orderedIds);
  });

  describe('space permissions under /api/wiki', () => {
    it('lists, sets and removes a grant with the bodies the frontend sends', async () => {
      const set = await as(request(app).put(`/api/wiki/spaces/${spaceId}/permissions`)).send({
        userId: memberId,
        level: 'EDIT',
      });
      expect(set.status).toBe(200);
      expect(set.body).toMatchObject({ userId: memberId, level: 'EDIT' });

      const byRole = await as(request(app).put(`/api/wiki/spaces/${spaceId}/permissions`)).send({
        teamRole: 'VIEWER',
        level: 'VIEW',
      });
      expect(byRole.status).toBe(200);

      const list = await as(request(app).get(`/api/wiki/spaces/${spaceId}/permissions`));
      expect(list.status).toBe(200);
      expect(list.body).toHaveLength(2);

      const removed = await as(
        request(app).delete(`/api/wiki/spaces/${spaceId}/permissions/${set.body.id}`),
      );
      expect(removed.status).toBe(204);
    });

    it.each([
      ['an unknown level', { userId: 'x', level: 'OWNER' }],
      ['no level', { teamRole: 'MEMBER' }],
      ['an unknown team role', { teamRole: 'BOSS', level: 'VIEW' }],
      ['neither user nor role', { level: 'VIEW' }],
      ['both user and role', { userId: 'x', teamRole: 'MEMBER', level: 'VIEW' }],
    ])('answers 400 for %s', async (_name, body) => {
      const res = await as(request(app).put(`/api/wiki/spaces/${spaceId}/permissions`)).send(body);
      expect(res.status).toBe(400);
    });

    it('answers 404 for a user that does not exist', async () => {
      const res = await as(request(app).put(`/api/wiki/spaces/${spaceId}/permissions`)).send({
        userId: 'no-such-user',
        level: 'VIEW',
      });
      expect(res.status).toBe(404);
    });

    it('refuses a user outside the space organization', async () => {
      const res = await as(request(app).put(`/api/wiki/spaces/${spaceId}/permissions`)).send({
        userId: outsiderId,
        level: 'VIEW',
      });
      expect(res.status).toBe(403);
      expect(await prisma.spacePermission.count({ where: { spaceId, userId: outsiderId } })).toBe(
        0,
      );
    });
  });

  it('requests an approval on the column named in the path, with approverIds', async () => {
    const board = await as(request(app).get(`/api/projects/${projectId}/board`));
    const columns: Array<{ id: string }> = board.body.columns ?? board.body;
    const [fromColumnId, toColumnId] = [columns[0].id, columns[1].id];
    const gate = await as(request(app).post(`/api/projects/${projectId}/approval-gates`)).send({
      fromColumnId,
      toColumnId,
      minApprovals: 1,
      allowSelfApproval: true,
    });
    expect(gate.status).toBe(201);
    const issue = await as(request(app).post(`/api/projects/${projectId}/issues`)).send({
      title: 'Needs approval',
      columnId: fromColumnId,
    });
    const res = await as(
      request(app).post(`/api/issues/${issue.body.id}/approval-requests/${toColumnId}`),
    ).send({ approverIds: [ownerId] });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('PENDING');
  });
});
