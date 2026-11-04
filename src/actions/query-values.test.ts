import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../config/database';
import app from '../index';
import { cleanupTestContext, createTestContext, type TestContext } from '../test/factory';

import { executeAction } from './execute';

// R16: query values that may repeat, or arrive as JSON from an MCP caller, answer 400 or read
// alike, never a 500 and never a filter the caller did not mean
describe('query values', () => {
  let ctx: TestContext;
  let auth: string;
  const mcp = () => ({
    userId: ctx.owner.id,
    channel: 'mcp' as const,
    scopes: ['sprints:read', 'teams:read'],
  });

  beforeAll(async () => {
    ctx = await createTestContext('qvq');
    auth = `Bearer ${ctx.owner.token}`;
    await prisma.sprint.create({
      data: {
        projectId: ctx.projectId,
        name: 'Active one',
        status: 'ACTIVE',
        startDate: new Date(),
        endDate: new Date(),
      },
    });
  });

  afterAll(async () => {
    await prisma.sprint.deleteMany({ where: { projectId: ctx.projectId } });
    await cleanupTestContext(ctx);
  });

  it('filters sprints by status, and reads an empty status as no filter', async () => {
    const base = `/api/projects/${ctx.projectId}/sprints`;
    const active = await request(app).get(`${base}?status=ACTIVE`).set('Authorization', auth);
    expect(active.body).toHaveLength(1);
    const planning = await request(app).get(`${base}?status=PLANNING`).set('Authorization', auth);
    expect(planning.body).toHaveLength(0);
    const all = await request(app).get(`${base}?status=`).set('Authorization', auth);
    expect(all.body).toHaveLength(1);
  });

  it.each([
    ['a repeated status', '?status=ACTIVE&status=PLANNING'],
    ['an unknown status', '?status=NOPE'],
  ])('answers 400 for %s', async (_label, query) => {
    const res = await request(app)
      .get(`/api/projects/${ctx.projectId}/sprints${query}`)
      .set('Authorization', auth);
    expect(res.status).toBe(400);
  });

  it.each([true, 5, { not: 'ACTIVE' }, ['ACTIVE']])(
    'refuses %j as a sprint status from MCP',
    async (status) => {
      await expect(
        executeAction('sprint.list', { projectId: ctx.projectId, status }, mcp()),
      ).rejects.toMatchObject({ statusCode: 400 });
    },
  );

  it.each([true, { a: 1 }, 1.5])('refuses %j as a velocity count from MCP', async (count) => {
    await expect(
      executeAction('sprint.velocity', { projectId: ctx.projectId, count }, mcp()),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('reads a repeated count as its first, and a number as its digits', async () => {
    const repeated = await request(app)
      .get(`/api/projects/${ctx.projectId}/velocity?count=2&count=9`)
      .set('Authorization', auth);
    expect(repeated.status).toBe(200);
    await expect(
      executeAction('sprint.velocity', { projectId: ctx.projectId, count: 2 }, mcp()),
    ).resolves.toBeDefined();
  });

  it('reads limit 0 as it reads "0"', async () => {
    const fromText = await request(app)
      .get(`/api/teams/org/${ctx.orgId}?limit=0`)
      .set('Authorization', auth);
    const fromNumber = await executeAction(
      'team.list',
      { orgId: ctx.orgId, limit: 0 },
      { ...mcp(), scopes: ['teams:read'] },
    );
    expect(fromText.status).toBe(200);
    expect(fromNumber).toMatchObject({ limit: fromText.body.limit });
  });

  it.each([true, { a: 1 }, 1.5])('refuses %j as a team limit from MCP', async (limit) => {
    await expect(
      executeAction('team.list', { orgId: ctx.orgId, limit }, mcp()),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});
