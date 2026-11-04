import crypto from 'crypto';

import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { prisma } from '../config/database';
import app from '../index';
import { createTestContext, cleanupTestContext, type TestContext } from '../test/factory';

describe('request context and via attribution', () => {
  let ctx: TestContext;
  let issueNumber: number;
  let issueId: string;
  let apiToken: { id: string; raw: string };

  beforeAll(async () => {
    ctx = await createTestContext('reqctx');
    const issue = await prisma.issue.create({
      data: {
        projectId: ctx.projectId,
        number: 1,
        title: 'Context test',
        body: 'body',
        creatorId: ctx.owner.id,
      },
    });
    issueNumber = issue.number;
    issueId = issue.id;

    const raw = `tk_${crypto.randomBytes(24).toString('hex')}`;
    const created = await prisma.apiToken.create({
      data: {
        userId: ctx.owner.id,
        name: 'Claude Code',
        tokenHash: crypto.createHash('sha256').update(raw).digest('hex'),
        prefix: raw.slice(0, 11),
        scopes: ['issues:write'],
      },
    });
    apiToken = { id: created.id, raw };
  });

  afterAll(async () => {
    await prisma.activity.deleteMany({ where: { resourceId: issueId } });
    await prisma.auditLog.deleteMany({ where: { userId: ctx.owner.id } });
    await prisma.apiToken.deleteMany({ where: { userId: ctx.owner.id } });
    await prisma.issue.deleteMany({ where: { projectId: ctx.projectId } });
    await cleanupTestContext(ctx);
  });

  const commentUrl = () => `/api/projects/${ctx.projectId}/issues/${issueNumber}/comments`;

  async function newestActivity() {
    return prisma.activity.findFirst({
      where: { resourceId: issueId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async function waitForAudit(userId: string, since: Date) {
    for (let i = 0; i < 40; i++) {
      const row = await prisma.auditLog.findFirst({
        where: { userId, createdAt: { gte: since }, resource: { startsWith: 'issue' } },
        orderBy: { createdAt: 'desc' },
      });
      if (row) return row;
      await new Promise((r) => setTimeout(r, 50));
    }
    return null;
  }

  it('records the token name as via on activity written inside a token request', async () => {
    const res = await request(app)
      .post(commentUrl())
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Authorization', `Token ${apiToken.raw}`)
      .send({ body: 'from a token' });
    expect(res.status).toBe(201);

    const activity = await newestActivity();
    expect(activity?.action).toBe('commented');
    expect(activity?.via).toBe('Claude Code');
    expect(activity?.apiTokenId).toBe(apiToken.id);
  });

  it('leaves via null for a browser session', async () => {
    const res = await request(app)
      .post(commentUrl())
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Authorization', `Bearer ${ctx.owner.token}`)
      .send({ body: 'from the browser' });
    expect(res.status).toBe(201);

    const activity = await newestActivity();
    expect(activity?.via).toBeNull();
    expect(activity?.apiTokenId).toBeNull();
  });

  it('audit log rows for token writes carry via', async () => {
    const since = new Date();
    const res = await request(app)
      .post(commentUrl())
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Authorization', `Token ${apiToken.raw}`)
      .send({ body: 'audited' });
    expect(res.status).toBe(201);

    const row = await waitForAudit(ctx.owner.id, since);
    expect(row?.via).toBe('Claude Code');
    expect(row?.apiTokenId).toBe(apiToken.id);
  });
});
