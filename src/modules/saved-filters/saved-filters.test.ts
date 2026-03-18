import bcrypt from 'bcryptjs';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { prisma } from '../../config/database';
import app from '../../index';

describe('Saved Filters API', () => {
  let token: string;
  let userId: string;

  const testUser = {
    email: 'sf-test@axiom.dev',
    username: 'sf-testuser',
    displayName: 'SF Test User',
    password: 'securepassword123',
  };

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash(testUser.password, 4);
    const user = await prisma.user.upsert({
      where: { username: testUser.username },
      update: {},
      create: {
        email: testUser.email,
        username: testUser.username,
        displayName: testUser.displayName,
        passwordHash,
      },
    });
    userId = user.id;

    const loginRes = await request(app)
      .post('/api/auth/login')
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({
        login: testUser.email,
        password: testUser.password,
      });
    token = loginRes.body.accessToken;
  });

  afterAll(async () => {
    await prisma.savedFilter.deleteMany({ where: { userId } });
    await prisma.refreshToken.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  // ── Create Saved Filter ────────────────────────────────────

  describe('POST /api/saved-filters', () => {
    it('should create a saved filter', async () => {
      const res = await request(app)
        .post('/api/saved-filters')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          name: 'My Open Bugs',
          query: { type: 'BUG', status: 'open' },
        });
      expect(res.status).toBe(201);
      expect(res.body.name).toBe('My Open Bugs');
      expect(res.body.query).toEqual({ type: 'BUG', status: 'open' });
    });

    it('should create another saved filter', async () => {
      const res = await request(app)
        .post('/api/saved-filters')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          name: 'High Priority Tasks',
          query: { priority: 'HIGH', type: 'TASK' },
        });
      expect(res.status).toBe(201);
      expect(res.body.name).toBe('High Priority Tasks');
    });

    it('should reject missing name or query', async () => {
      const res = await request(app)
        .post('/api/saved-filters')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ name: 'No Query' });
      expect(res.status).toBe(400);
    });
  });

  // ── List Saved Filters ─────────────────────────────────────

  describe('GET /api/saved-filters', () => {
    it('should list saved filters for the user', async () => {
      const res = await request(app)
        .get('/api/saved-filters')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ── Update Saved Filter ────────────────────────────────────

  describe('PATCH /api/saved-filters/:filterId', () => {
    it('should update a saved filter', async () => {
      const listRes = await request(app)
        .get('/api/saved-filters')
        .set('Authorization', `Bearer ${token}`);
      const filterId = listRes.body[0].id;

      const res = await request(app)
        .patch(`/api/saved-filters/${filterId}`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ name: 'Updated Filter Name' });
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Updated Filter Name');
    });
  });

  // ── Delete Saved Filter ────────────────────────────────────

  describe('DELETE /api/saved-filters/:filterId', () => {
    it('should delete a saved filter', async () => {
      // Create one to delete
      const createRes = await request(app)
        .post('/api/saved-filters')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ name: 'To Delete', query: { status: 'closed' } });
      const filterId = createRes.body.id;

      const res = await request(app)
        .delete(`/api/saved-filters/${filterId}`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Requested-With', 'XMLHttpRequest');
      expect(res.status).toBe(204);

      // Verify deletion
      const listRes = await request(app)
        .get('/api/saved-filters')
        .set('Authorization', `Bearer ${token}`);
      const ids = listRes.body.map((f: { id: string }) => f.id);
      expect(ids).not.toContain(filterId);
    });
  });

  // ── Unauthenticated Access ─────────────────────────────────

  describe('Unauthenticated access', () => {
    it('should reject unauthenticated requests', async () => {
      const res = await request(app).get('/api/saved-filters');
      expect(res.status).toBe(401);
    });
  });
});
