import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { prisma } from '../../config/database';

import { createNotification, updatePreference } from './notifications.service';

// Mock the email queue to capture enqueue calls without needing Redis
const mockAdd = vi.fn().mockResolvedValue({ id: 'job-1' });
vi.mock('../../email/queue', () => ({
  emailQueue: { add: mockAdd },
}));

// Mock broadcast to avoid WebSocket side effects
vi.mock('../../realtime/broadcast', () => ({
  broadcastToUser: vi.fn(),
}));

describe('Notification Email Enqueue Integration', () => {
  let userId: string;
  const testEmail = 'notif-email-test@axiom.dev';
  const testUsername = 'notif-email-tester';

  beforeEach(async () => {
    const bcrypt = await import('bcryptjs');
    const passwordHash = await bcrypt.hash('testpassword', 4);
    const user = await prisma.user.upsert({
      where: { username: testUsername },
      update: {},
      create: {
        email: testEmail,
        username: testUsername,
        displayName: 'Email Test User',
        passwordHash,
      },
    });
    userId = user.id;
    mockAdd.mockClear();
  });

  afterEach(async () => {
    await prisma.notificationPreference.deleteMany({ where: { userId } });
    await prisma.notification.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it('should not enqueue email when SMTP_HOST is not set', async () => {
    const origSmtp = process.env.SMTP_HOST;
    delete process.env.SMTP_HOST;

    await updatePreference(userId, 'issue_assigned', { email: true });
    await createNotification(userId, 'issue_assigned', 'Test title', 'Test body', '/issues/1');

    expect(mockAdd).not.toHaveBeenCalled();
    process.env.SMTP_HOST = origSmtp;
  });

  describe('agent:approval (A8)', () => {
    const send = () =>
      createNotification(userId, 'agent:approval', 'agent wants to: Delete', undefined, '/a/1');

    it('emails with no preference stored', async () => {
      process.env.SMTP_HOST = 'localhost';
      await send();
      expect(mockAdd).toHaveBeenCalledWith(
        'send',
        expect.objectContaining({ to: testEmail, type: 'agent:approval', link: '/a/1' }),
      );
    });

    it('emails after an opt-out, which a token could have made', async () => {
      process.env.SMTP_HOST = 'localhost';
      await updatePreference(userId, 'agent:approval', { email: false, inApp: false });
      await send();
      expect(mockAdd).toHaveBeenCalledTimes(1);
      expect(await prisma.notification.count({ where: { userId } })).toBe(1);
    });

    it('still honours the opt-out of every other type', async () => {
      process.env.SMTP_HOST = 'localhost';
      await updatePreference(userId, 'issue_assigned', { email: false });
      await createNotification(userId, 'issue_assigned', 'Title', 'Body', '/issues/1');
      expect(mockAdd).not.toHaveBeenCalled();
    });

    it('sends nothing without SMTP', async () => {
      const original = process.env.SMTP_HOST;
      delete process.env.SMTP_HOST;
      await send();
      expect(mockAdd).not.toHaveBeenCalled();
      process.env.SMTP_HOST = original;
    });
  });

  it('should not enqueue email when user has email preference disabled', async () => {
    process.env.SMTP_HOST = 'localhost';

    // email defaults to false, so no explicit pref needed
    await createNotification(userId, 'issue_assigned', 'Test title', 'Test body', '/issues/1');

    expect(mockAdd).not.toHaveBeenCalled();
    delete process.env.SMTP_HOST;
  });

  it('should not enqueue email when user has explicit email=false preference', async () => {
    process.env.SMTP_HOST = 'localhost';

    await updatePreference(userId, 'issue_commented', { email: false });
    await createNotification(userId, 'issue_commented', 'Comment title', 'A comment', '/issues/2');

    expect(mockAdd).not.toHaveBeenCalled();
    delete process.env.SMTP_HOST;
  });

  it('should enqueue email when user has email preference enabled and SMTP is configured', async () => {
    process.env.SMTP_HOST = 'localhost';

    await updatePreference(userId, 'issue_assigned', { email: true });
    await createNotification(
      userId,
      'issue_assigned',
      'Assigned to you',
      'Please look',
      '/issues/5',
    );

    expect(mockAdd).toHaveBeenCalledTimes(1);
    expect(mockAdd).toHaveBeenCalledWith('send', {
      to: testEmail,
      recipientName: 'Email Test User',
      type: 'issue_assigned',
      title: 'Assigned to you',
      body: 'Please look',
      link: '/issues/5',
    });

    delete process.env.SMTP_HOST;
  });

  it('should use username as recipientName when displayName is empty', async () => {
    process.env.SMTP_HOST = 'localhost';

    // Update user to have empty displayName
    await prisma.user.update({
      where: { id: userId },
      data: { displayName: '' },
    });

    await updatePreference(userId, 'mention', { email: true });
    await createNotification(userId, 'mention', 'You were mentioned', undefined, '/issues/3');

    expect(mockAdd).toHaveBeenCalledTimes(1);
    expect(mockAdd).toHaveBeenCalledWith('send', {
      to: testEmail,
      recipientName: testUsername,
      type: 'mention',
      title: 'You were mentioned',
      body: undefined,
      link: '/issues/3',
    });

    delete process.env.SMTP_HOST;
  });

  it('should still create notification even if email enqueue fails', async () => {
    process.env.SMTP_HOST = 'localhost';

    await updatePreference(userId, 'issue_commented', { email: true });
    mockAdd.mockRejectedValueOnce(new Error('Redis down'));

    const notification = await createNotification(
      userId,
      'issue_commented',
      'PR merged',
      'Your PR was merged',
      '/pulls/1',
    );

    // Notification should still be created successfully
    expect(notification).toBeDefined();
    expect(notification.id).toBeTruthy();
    expect(notification.title).toBe('PR merged');

    // Verify it was persisted
    const found = await prisma.notification.findUnique({ where: { id: notification.id } });
    expect(found).not.toBeNull();

    delete process.env.SMTP_HOST;
  });

  it('should enqueue for each of the 3 notification types when enabled', async () => {
    process.env.SMTP_HOST = 'localhost';

    const types = ['issue_assigned', 'issue_commented', 'mention'];

    for (const type of types) {
      await updatePreference(userId, type, { email: true });
    }

    for (const type of types) {
      await createNotification(
        userId,
        type,
        `Title for ${type}`,
        `Body for ${type}`,
        `/link/${type}`,
      );
    }

    expect(mockAdd).toHaveBeenCalledTimes(3);

    for (let i = 0; i < types.length; i++) {
      expect(mockAdd).toHaveBeenCalledWith(
        'send',
        expect.objectContaining({
          type: types[i],
          title: `Title for ${types[i]}`,
        }),
      );
    }

    delete process.env.SMTP_HOST;
  });
});
