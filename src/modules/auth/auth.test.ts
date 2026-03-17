import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import app from '../../index';
import { prisma } from '../../config/database';

describe('Auth API', () => {
  const testUser = {
    email: 'test@axiom.dev',
    username: 'testuser',
    displayName: 'Test User',
    password: 'securepassword123',
  };

  // Seed the test user directly via Prisma so tests don't depend on
  // the register endpoint (which requires an invite when users already exist).
  beforeAll(async () => {
    const passwordHash = await bcrypt.hash(testUser.password, 4); // low rounds for speed
    await prisma.user.upsert({
      where: { username: testUser.username },
      update: {},
      create: {
        email: testUser.email,
        username: testUser.username,
        displayName: testUser.displayName,
        passwordHash,
      },
    });
  });

  afterAll(async () => {
    const user = await prisma.user.findUnique({ where: { email: testUser.email } });
    if (user) {
      await prisma.refreshToken.deleteMany({ where: { userId: user.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
    await prisma.$disconnect();
  });

  // ── Registration ─────────────────────────────────────────────

  describe('POST /api/auth/register', () => {
    it('should reject registration without invite when users exist', async () => {
      const res = await request(app).post('/api/auth/register').send({
        email: 'newuser@axiom.dev',
        username: 'newuser',
        displayName: 'New User',
        password: 'securepassword123',
      });
      expect(res.status).toBe(403);
    });

    it('should reject weak password', async () => {
      const res = await request(app).post('/api/auth/register').send({
        email: 'other@axiom.dev',
        username: 'other',
        displayName: 'Other User',
        password: 'short',
      });
      expect(res.status).toBe(400);
    });
  });

  // ── Login ────────────────────────────────────────────────────

  describe('POST /api/auth/login', () => {
    it('should login with email', async () => {
      const res = await request(app).post('/api/auth/login').send({
        login: testUser.email,
        password: testUser.password,
      });
      expect(res.status).toBe(200);
      expect(res.body.accessToken).toBeDefined();
      expect(res.body.refreshToken).toBeDefined();
    });

    it('should login with username', async () => {
      const res = await request(app).post('/api/auth/login').send({
        login: testUser.username,
        password: testUser.password,
      });
      expect(res.status).toBe(200);
      expect(res.body.accessToken).toBeDefined();
    });

    it('should reject wrong password', async () => {
      const res = await request(app).post('/api/auth/login').send({
        login: testUser.email,
        password: 'wrongpassword',
      });
      expect(res.status).toBe(401);
    });

    it('should not expose password hash in response', async () => {
      const res = await request(app).post('/api/auth/login').send({
        login: testUser.email,
        password: testUser.password,
      });
      expect(res.status).toBe(200);
      expect(res.body.user.passwordHash).toBeUndefined();
    });
  });

  // ── Refresh ──────────────────────────────────────────────────

  describe('POST /api/auth/refresh', () => {
    it('should issue new tokens with valid refresh token', async () => {
      const loginRes = await request(app).post('/api/auth/login').send({
        login: testUser.email,
        password: testUser.password,
      });
      expect(loginRes.status).toBe(200);

      const res = await request(app).post('/api/auth/refresh').send({
        refreshToken: loginRes.body.refreshToken,
      });
      expect(res.status).toBe(200);
      expect(res.body.accessToken).toBeDefined();
      expect(res.body.refreshToken).toBeDefined();
      // Old refresh token should be rotated (no longer valid)
      expect(res.body.refreshToken).not.toBe(loginRes.body.refreshToken);
    });
  });

  // ── Authenticated routes ─────────────────────────────────────

  describe('Authenticated routes', () => {
    let token: string;

    beforeAll(async () => {
      const res = await request(app).post('/api/auth/login').send({
        login: testUser.email,
        password: testUser.password,
      });
      token = res.body.accessToken;
    });

    it('should access profile with valid token', async () => {
      const res = await request(app)
        .get('/api/users/me')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.email).toBe(testUser.email);
    });

    it('should reject unauthenticated request', async () => {
      const res = await request(app).get('/api/users/me');
      expect(res.status).toBe(401);
    });
  });

  // ── Token Persistence & Rotation ────────────────────────────

  describe('Refresh token persistence', () => {
    it('should persist refresh token in the database on login', async () => {
      // Clean up any existing refresh tokens for this user
      const user = await prisma.user.findUnique({ where: { email: testUser.email } });
      await prisma.refreshToken.deleteMany({ where: { userId: user!.id } });

      const loginRes = await request(app).post('/api/auth/login').send({
        login: testUser.email,
        password: testUser.password,
      });
      expect(loginRes.status).toBe(200);

      const tokens = await prisma.refreshToken.findMany({ where: { userId: user!.id } });
      expect(tokens).toHaveLength(1);
      // Token should have a future expiration date
      expect(tokens[0].expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('should rotate refresh token (old token deleted, new one created)', async () => {
      const loginRes = await request(app).post('/api/auth/login').send({
        login: testUser.email,
        password: testUser.password,
      });
      expect(loginRes.status).toBe(200);
      const oldRefresh = loginRes.body.refreshToken;

      const user = await prisma.user.findUnique({ where: { email: testUser.email } });
      const countBefore = await prisma.refreshToken.count({ where: { userId: user!.id } });

      // Refresh — should delete old, create new
      const refreshRes = await request(app).post('/api/auth/refresh').send({
        refreshToken: oldRefresh,
      });
      expect(refreshRes.status).toBe(200);

      const countAfter = await prisma.refreshToken.count({ where: { userId: user!.id } });
      // Count should stay the same (old deleted, new created)
      expect(countAfter).toBe(countBefore);

      // The new refresh token should work for a second refresh
      const secondRefresh = await request(app).post('/api/auth/refresh').send({
        refreshToken: refreshRes.body.refreshToken,
      });
      expect(secondRefresh.status).toBe(200);
      expect(secondRefresh.body.accessToken).toBeDefined();
      expect(secondRefresh.body.refreshToken).toBeDefined();
    });

    it('should reject a reused (already-rotated) refresh token', async () => {
      const loginRes = await request(app).post('/api/auth/login').send({
        login: testUser.email,
        password: testUser.password,
      });
      expect(loginRes.status).toBe(200);
      const oldRefresh = loginRes.body.refreshToken;

      // Use the token once — this rotates it
      const firstRefresh = await request(app).post('/api/auth/refresh').send({
        refreshToken: oldRefresh,
      });
      expect(firstRefresh.status).toBe(200);

      // Try to reuse the old token — should fail
      const reuse = await request(app).post('/api/auth/refresh').send({
        refreshToken: oldRefresh,
      });
      expect(reuse.status).toBe(401);
    });

    it('should reject an invalid refresh token', async () => {
      const res = await request(app).post('/api/auth/refresh').send({
        refreshToken: 'completely-invalid-token-value',
      });
      expect(res.status).toBe(401);
    });

    it('should support multiple concurrent sessions', async () => {
      // Login twice to create two independent sessions
      const session1 = await request(app).post('/api/auth/login').send({
        login: testUser.email,
        password: testUser.password,
      });
      const session2 = await request(app).post('/api/auth/login').send({
        login: testUser.email,
        password: testUser.password,
      });
      expect(session1.status).toBe(200);
      expect(session2.status).toBe(200);

      // Both refresh tokens should be different
      expect(session1.body.refreshToken).not.toBe(session2.body.refreshToken);

      // Both should be independently refreshable
      const refresh1 = await request(app).post('/api/auth/refresh').send({
        refreshToken: session1.body.refreshToken,
      });
      const refresh2 = await request(app).post('/api/auth/refresh').send({
        refreshToken: session2.body.refreshToken,
      });
      expect(refresh1.status).toBe(200);
      expect(refresh2.status).toBe(200);
    });

    it('should return a new access token that grants API access after refresh', async () => {
      const loginRes = await request(app).post('/api/auth/login').send({
        login: testUser.email,
        password: testUser.password,
      });
      expect(loginRes.status).toBe(200);

      const refreshRes = await request(app).post('/api/auth/refresh').send({
        refreshToken: loginRes.body.refreshToken,
      });
      expect(refreshRes.status).toBe(200);

      // The new access token should work for authenticated requests
      const profileRes = await request(app)
        .get('/api/users/me')
        .set('Authorization', `Bearer ${refreshRes.body.accessToken}`);
      expect(profileRes.status).toBe(200);
      expect(profileRes.body.email).toBe(testUser.email);
    });
  });
});
