import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../../config/database';
import app from '../../index';
import { createTestUser, type TestUser } from '../../test/factory';

describe('the request counters are for a platform admin', () => {
  let admin: TestUser;
  let member: TestUser;

  beforeAll(async () => {
    admin = await createTestUser();
    member = await createTestUser();
    await prisma.user.update({ where: { id: admin.id }, data: { isAdmin: true } });
  });

  afterAll(async () => {
    const ids = [admin.id, member.id];
    await prisma.auditLog.deleteMany({ where: { userId: { in: ids } } });
    await prisma.refreshToken.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  });

  it('keeps the plain health check open to anyone', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
  });

  it('refuses an anonymous caller', async () => {
    const res = await request(app).get('/api/health/metrics');
    expect(res.status).toBe(401);
    expect(res.body.totalRequests).toBeUndefined();
  });

  it('refuses a signed-in user who is not a platform admin', async () => {
    const res = await request(app)
      .get('/api/health/metrics')
      .set('Authorization', `Bearer ${member.token}`);
    expect(res.status).toBe(403);
    expect(res.body.totalRequests).toBeUndefined();
  });

  it('answers a platform admin with the counters', async () => {
    const res = await request(app)
      .get('/api/health/metrics')
      .set('Authorization', `Bearer ${admin.token}`);
    expect(res.status).toBe(200);
    expect(res.body.totalRequests).toBeTypeOf('number');
  });
});
