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

const XHR = { 'X-Requested-With': 'XMLHttpRequest' };

describe('Issue actions: access and ids', () => {
  let ctx: TestContext;
  let viewer: TestUser;
  let outsider: TestUser;
  let issue: string;

  const as = (user: TestUser) => `Bearer ${user.token}`;

  beforeAll(async () => {
    ctx = await createTestContext('issue-actions');
    viewer = await addMemberToContext(ctx, {
      email: 'issue-actions-viewer@test.dev',
      username: 'issue-actions-viewer',
    });
    await prisma.teamMembership.updateMany({
      where: { teamId: ctx.teamId, userId: viewer.id },
      data: { role: 'VIEWER' },
    });
    await prisma.orgMembership.updateMany({
      where: { orgId: ctx.orgId, userId: viewer.id },
      data: { role: 'VIEWER' },
    });
    outsider = await createTestUser({
      email: 'issue-actions-outsider@test.dev',
      username: 'issue-actions-outsider',
    });
    const created = await request(app)
      .post(`/api/projects/${ctx.projectId}/issues`)
      .set('Authorization', as(ctx.owner))
      .set(XHR)
      .send({ title: 'Votes and watches' });
    issue = `/api/projects/${ctx.projectId}/issues/${created.body.number}`;
  });

  afterAll(async () => {
    await cleanupTestContext(ctx);
    await prisma.user.deleteMany({ where: { id: { in: [viewer.id, outsider.id] } } });
  });

  it.each(['votes', 'watchers'])('refuses an outsider on %s/toggle', async (kind) => {
    const res = await request(app)
      .post(`${issue}/${kind}/toggle`)
      .set('Authorization', as(outsider))
      .set(XHR)
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it.each([
    ['votes', 'voted'],
    ['watchers', 'watching'],
  ])('lets a VIEWER use %s/toggle', async (kind, key) => {
    const res = await request(app)
      .post(`${issue}/${kind}/toggle`)
      .set('Authorization', as(viewer))
      .set(XHR)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body[key]).toBe(true);
  });

  it('still keeps a VIEWER from editing the issue', async () => {
    const res = await request(app)
      .patch(issue)
      .set('Authorization', as(viewer))
      .set(XHR)
      .send({ title: 'Changed' });
    expect(res.status).toBe(403);
  });

  it.each(['5abc', '1e1', '0x10', '-1', ' 5'])('rejects issue number %j with 400', async (n) => {
    const res = await request(app)
      .get(`/api/projects/${ctx.projectId}/issues/${encodeURIComponent(n)}`)
      .set('Authorization', as(ctx.owner));
    expect(res.status).toBe(400);
  });

  it.each(['5abc', '1.5', 'x'])('rejects parentIssueNumber %j with 400', async (parent) => {
    const res = await request(app)
      .patch(`${issue}/parent`)
      .set('Authorization', as(ctx.owner))
      .set(XHR)
      .send({ parentIssueNumber: parent });
    expect(res.status).toBe(400);
  });

  it('refuses an outsider before it checks the issue number', async () => {
    const res = await request(app)
      .get(`/api/projects/${ctx.projectId}/issues/5abc`)
      .set('Authorization', as(outsider));
    expect(res.status).toBe(403);
  });
});
