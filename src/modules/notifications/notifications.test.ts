import bcrypt from 'bcryptjs';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { prisma } from '../../config/database';
import app from '../../index';

describe('Notifications API', () => {
  let token: string;
  let userId: string;
  let notificationIds: string[] = [];

  const testUser = {
    email: 'notif-test@axiom.dev',
    username: 'notif-testuser',
    displayName: 'Notif Test User',
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

    // Create some test notifications directly via Prisma
    const n1 = await prisma.notification.create({
      data: {
        userId,
        type: 'issue:assigned',
        title: 'You were assigned to issue #1',
        body: 'Test notification body',
        link: '/issues/1',
        read: false,
      },
    });
    const n2 = await prisma.notification.create({
      data: {
        userId,
        type: 'pr:review_requested',
        title: 'Review requested on PR #5',
        read: false,
      },
    });
    const n3 = await prisma.notification.create({
      data: {
        userId,
        type: 'mention',
        title: 'You were mentioned in a comment',
        read: true,
      },
    });
    notificationIds = [n1.id, n2.id, n3.id];

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
    await prisma.notification.deleteMany({ where: { userId } });
    await prisma.refreshToken.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  // ── List Notifications ─────────────────────────────────────

  describe('GET /api/notifications', () => {
    it('should list all notifications for the user', async () => {
      const res = await request(app)
        .get('/api/notifications')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('notifications');
      expect(res.body.notifications.length).toBeGreaterThanOrEqual(3);
    });

    it('should filter by unread only', async () => {
      const res = await request(app)
        .get('/api/notifications?unreadOnly=true')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.notifications.every((n: { read: boolean }) => n.read === false)).toBe(true);
    });
  });

  // ── Unread Count ───────────────────────────────────────────

  describe('GET /api/notifications/unread-count', () => {
    it('should return unread count', async () => {
      const res = await request(app)
        .get('/api/notifications/unread-count')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.count).toBe(2); // n1 and n2 are unread
    });
  });

  // ── Mark Read ──────────────────────────────────────────────

  describe('PATCH /api/notifications/:id/read', () => {
    it('should mark a notification as read', async () => {
      const res = await request(app)
        .patch(`/api/notifications/${notificationIds[0]}/read`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Requested-With', 'XMLHttpRequest');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify count decreased
      const countRes = await request(app)
        .get('/api/notifications/unread-count')
        .set('Authorization', `Bearer ${token}`);
      expect(countRes.body.count).toBe(1);
    });
  });

  // ── Mark All Read ──────────────────────────────────────────

  describe('POST /api/notifications/read-all', () => {
    it('should mark all notifications as read', async () => {
      const res = await request(app)
        .post('/api/notifications/read-all')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Requested-With', 'XMLHttpRequest');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify all are read now
      const countRes = await request(app)
        .get('/api/notifications/unread-count')
        .set('Authorization', `Bearer ${token}`);
      expect(countRes.body.count).toBe(0);
    });
  });

  // ── Unauthenticated Access ─────────────────────────────────

  describe('Unauthenticated access', () => {
    it('should reject unauthenticated requests', async () => {
      const res = await request(app).get('/api/notifications');
      expect(res.status).toBe(401);
    }, 15000);
  });
});
