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
    await prisma.notificationPreference.deleteMany({ where: { userId } });
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

  // ── Notification Preferences ──────────────────────────────

  describe('GET /api/notifications/preferences', () => {
    it('should return default preferences for all 4 event types', async () => {
      const res = await request(app)
        .get('/api/notifications/preferences')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('preferences');
      expect(res.body.preferences).toHaveLength(4);

      const eventTypes = res.body.preferences.map((p: { eventType: string }) => p.eventType);
      expect(eventTypes).toContain('issue_assigned');
      expect(eventTypes).toContain('issue_commented');
      expect(eventTypes).not.toContain('pr_review_requested');
      expect(eventTypes).not.toContain('pr_merged');
      expect(eventTypes).toContain('mention');
      // So the settings page offers email for an agent's request for approval
      expect(eventTypes).toContain('agent:approval');

      for (const pref of res.body.preferences) {
        expect(pref.inApp).toBe(true);
        expect(pref.email).toBe(false);
      }
    });
  });

  describe('PATCH /api/notifications/preferences', () => {
    it.each([[['agent:approval']], [{ equals: 'mention' }], [5], [undefined]])(
      'answers 400 when eventType is %j',
      async (eventType) => {
        const res = await request(app)
          .patch('/api/notifications/preferences')
          .set('Authorization', `Bearer ${token}`)
          .set('X-Requested-With', 'XMLHttpRequest')
          .send({ eventType, email: true });
        expect(res.status).toBe(400);
      },
    );

    it('should enable email preference and persist it', async () => {
      const res = await request(app)
        .patch('/api/notifications/preferences')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ eventType: 'issue_assigned', email: true });
      expect(res.status).toBe(200);
      expect(res.body.preference.email).toBe(true);
      expect(res.body.preference.eventType).toBe('issue_assigned');

      // Verify it persists
      const getRes = await request(app)
        .get('/api/notifications/preferences')
        .set('Authorization', `Bearer ${token}`);
      const pref = getRes.body.preferences.find(
        (p: { eventType: string }) => p.eventType === 'issue_assigned',
      );
      expect(pref.email).toBe(true);
    });

    it('should disable email preference', async () => {
      const res = await request(app)
        .patch('/api/notifications/preferences')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ eventType: 'issue_assigned', email: false });
      expect(res.status).toBe(200);
      expect(res.body.preference.email).toBe(false);
    });

    it('should toggle both inApp and email in single request', async () => {
      const res = await request(app)
        .patch('/api/notifications/preferences')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ eventType: 'issue_commented', inApp: false, email: true });
      expect(res.status).toBe(200);
      expect(res.body.preference.inApp).toBe(false);
      expect(res.body.preference.email).toBe(true);

      // Reset
      await request(app)
        .patch('/api/notifications/preferences')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ eventType: 'issue_commented', inApp: true, email: false });
    });

    it('should update a single preference (disable inApp for mention)', async () => {
      const res = await request(app)
        .patch('/api/notifications/preferences')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ eventType: 'mention', inApp: false });
      expect(res.status).toBe(200);
      expect(res.body.preference.eventType).toBe('mention');
      expect(res.body.preference.inApp).toBe(false);
    });

    it('should reflect the updated inApp value on GET', async () => {
      const res = await request(app)
        .get('/api/notifications/preferences')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);

      const mentionPref = res.body.preferences.find(
        (p: { eventType: string }) => p.eventType === 'mention',
      );
      expect(mentionPref.inApp).toBe(false);
      expect(mentionPref.email).toBe(false);
    });

    it('should enable email for an event type', async () => {
      const res = await request(app)
        .patch('/api/notifications/preferences')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ eventType: 'issue_assigned', email: true });
      expect(res.status).toBe(200);
      expect(res.body.preference.eventType).toBe('issue_assigned');
      expect(res.body.preference.email).toBe(true);
    });

    it('should show both changes persisted on GET', async () => {
      const res = await request(app)
        .get('/api/notifications/preferences')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);

      const mentionPref = res.body.preferences.find(
        (p: { eventType: string }) => p.eventType === 'mention',
      );
      expect(mentionPref.inApp).toBe(false);

      const assignedPref = res.body.preferences.find(
        (p: { eventType: string }) => p.eventType === 'issue_assigned',
      );
      expect(assignedPref.email).toBe(true);
    });
  });
});
