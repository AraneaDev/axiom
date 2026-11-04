import crypto from 'crypto';

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

describe('Issue web links', () => {
  let ctx: TestContext;
  let viewer: TestUser;
  let outsider: TestUser;
  let base: string;
  let otherIssueBase: string;

  const as = (user: TestUser) => `Bearer ${user.token}`;

  /**
   * A token for the owner, as the REST API takes it.
   * @param scopes - The token's scopes
   */
  async function tokenWith(scopes: string[]): Promise<string> {
    const raw = `tk_${crypto.randomBytes(24).toString('hex')}`;
    await prisma.apiToken.create({
      data: {
        userId: ctx.owner.id,
        name: 'web-links-test',
        tokenHash: crypto.createHash('sha256').update(raw).digest('hex'),
        prefix: raw.slice(0, 11),
        scopes,
      },
    });
    return `Token ${raw}`;
  }

  beforeAll(async () => {
    ctx = await createTestContext('web-links');
    viewer = await addMemberToContext(ctx, {
      email: 'web-links-viewer@test.dev',
      username: 'web-links-viewer',
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
      email: 'web-links-outsider@test.dev',
      username: 'web-links-outsider',
    });

    const create = async (title: string) =>
      request(app)
        .post(`/api/projects/${ctx.projectId}/issues`)
        .set('Authorization', as(ctx.owner))
        .set(XHR)
        .send({ title });
    const first = await create('Has links');
    const second = await create('Has none');
    base = `/api/projects/${ctx.projectId}/issues/${first.body.number}/web-links`;
    otherIssueBase = `/api/projects/${ctx.projectId}/issues/${second.body.number}/web-links`;
  });

  afterAll(async () => {
    await prisma.apiToken.deleteMany({ where: { userId: ctx.owner.id } });
    await cleanupTestContext(ctx);
    await prisma.user.deleteMany({ where: { id: { in: [viewer.id, outsider.id] } } });
  });

  it('adds, lists and deletes a link', async () => {
    const added = await request(app)
      .post(base)
      .set('Authorization', as(ctx.owner))
      .set(XHR)
      .send({ url: 'https://example.com/spec', title: 'Spec' });
    expect(added.status).toBe(201);
    expect(added.body).toMatchObject({
      url: 'https://example.com/spec',
      title: 'Spec',
      createdById: ctx.owner.id,
    });

    const listed = await request(app).get(base).set('Authorization', as(ctx.owner));
    expect(listed.status).toBe(200);
    expect(listed.body.map((link: { id: string }) => link.id)).toEqual([added.body.id]);

    const removed = await request(app)
      .delete(`${base}/${added.body.id}`)
      .set('Authorization', as(ctx.owner))
      .set(XHR);
    expect(removed.status).toBe(204);
    const after = await request(app).get(base).set('Authorization', as(ctx.owner));
    expect(after.body).toEqual([]);
  });

  it('keeps a link to the issue it was added to', async () => {
    const added = await request(app)
      .post(base)
      .set('Authorization', as(ctx.owner))
      .set(XHR)
      .send({ url: 'https://example.com/only-here' });
    expect(added.body.title).toBeNull();

    const wrongIssue = await request(app)
      .delete(`${otherIssueBase}/${added.body.id}`)
      .set('Authorization', as(ctx.owner))
      .set(XHR);
    expect(wrongIssue.status).toBe(404);
    const still = await request(app).get(base).set('Authorization', as(ctx.owner));
    expect(still.body).toHaveLength(1);
  });

  it('lets a VIEWER read links but not add or delete them', async () => {
    const [link] = (await request(app).get(base).set('Authorization', as(ctx.owner))).body;

    const read = await request(app).get(base).set('Authorization', as(viewer));
    expect(read.status).toBe(200);

    const add = await request(app)
      .post(base)
      .set('Authorization', as(viewer))
      .set(XHR)
      .send({ url: 'https://example.com/nope' });
    expect(add.status).toBe(403);

    const del = await request(app)
      .delete(`${base}/${link.id}`)
      .set('Authorization', as(viewer))
      .set(XHR);
    expect(del.status).toBe(403);
  });

  it('refuses someone outside the team', async () => {
    const res = await request(app).get(base).set('Authorization', as(outsider));
    expect(res.status).toBe(403);
  });

  it.each(['javascript:alert(1)', 'data:text/html,x', 'ftp://example.com', 'not a url'])(
    'rejects %s with 400',
    async (url) => {
      const res = await request(app)
        .post(base)
        .set('Authorization', as(ctx.owner))
        .set(XHR)
        .send({ url });
      expect(res.status).toBe(400);
    },
  );

  it('answers 403 before 400 to a caller who may not add', async () => {
    const res = await request(app)
      .post(base)
      .set('Authorization', as(viewer))
      .set(XHR)
      .send({ url: 'javascript:alert(1)' });
    expect(res.status).toBe(403);
  });

  it('refuses a token that holds only wiki:write', async () => {
    const res = await request(app)
      .post(base)
      .set('Authorization', await tokenWith(['wiki:write']))
      .set(XHR)
      .send({ url: 'https://example.com/wiki-token' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('SCOPE');
  });

  it('accepts a token with issues:write', async () => {
    const res = await request(app)
      .post(base)
      .set('Authorization', await tokenWith(['issues:write']))
      .set(XHR)
      .send({ url: 'https://example.com/issues-token' });
    expect(res.status).toBe(201);
  });

  it('answers 404 for a link id that belongs to another project', async () => {
    const other = await createTestContext('web-links-other');
    try {
      const issueRes = await request(app)
        .post(`/api/projects/${other.projectId}/issues`)
        .set('Authorization', as(other.owner))
        .set(XHR)
        .send({ title: 'Elsewhere' });
      const foreign = await request(app)
        .post(`/api/projects/${other.projectId}/issues/${issueRes.body.number}/web-links`)
        .set('Authorization', as(other.owner))
        .set(XHR)
        .send({ url: 'https://example.com/foreign' });
      expect(foreign.status).toBe(201);

      const res = await request(app)
        .delete(`${base}/${foreign.body.id}`)
        .set('Authorization', as(ctx.owner))
        .set(XHR);
      expect(res.status).toBe(404);
      expect(await prisma.issueWebLink.count({ where: { id: foreign.body.id } })).toBe(1);
    } finally {
      await cleanupTestContext(other);
    }
  });
});
