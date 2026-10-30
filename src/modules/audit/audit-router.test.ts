/**
 * The audit router enforces admin access itself, not through its mount order under /api/admin.
 */
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../../config/database';
import { errorHandler } from '../../middleware/errorHandler';
import { createTestUser, type TestUser } from '../../test/factory';

import auditRoutes from './audit.routes';

describe('Audit router on its own', () => {
  let user: TestUser;
  const app = express();
  app.use('/audit', auditRoutes);
  app.use(errorHandler);

  beforeAll(async () => {
    user = await createTestUser();
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: user.id } });
  });

  it('refuses a non-admin', async () => {
    const res = await request(app).get('/audit').set('Authorization', `Bearer ${user.token}`);
    expect(res.status).toBe(403);
  });
});
