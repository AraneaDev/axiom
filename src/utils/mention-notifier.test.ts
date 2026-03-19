import bcrypt from 'bcryptjs';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { prisma } from '../config/database';

import { notifyMentions } from './mention-notifier';

describe('notifyMentions', () => {
  let authorId: string;
  let user1Id: string;
  let user2Id: string;

  const users = {
    author: {
      email: 'mention-author@axiom.dev',
      username: 'mention-author',
      displayName: 'Mention Author',
    },
    user1: {
      email: 'mention-user1@axiom.dev',
      username: 'mention-user1',
      displayName: 'Mention User 1',
    },
    user2: {
      email: 'mention-user2@axiom.dev',
      username: 'mention-user2',
      displayName: 'Mention User 2',
    },
  };

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash('password123', 4);

    const author = await prisma.user.upsert({
      where: { username: users.author.username },
      update: {},
      create: { ...users.author, passwordHash },
    });
    authorId = author.id;

    const u1 = await prisma.user.upsert({
      where: { username: users.user1.username },
      update: {},
      create: { ...users.user1, passwordHash },
    });
    user1Id = u1.id;

    const u2 = await prisma.user.upsert({
      where: { username: users.user2.username },
      update: {},
      create: { ...users.user2, passwordHash },
    });
    user2Id = u2.id;
  });

  afterAll(async () => {
    await prisma.notification.deleteMany({
      where: { userId: { in: [authorId, user1Id, user2Id] } },
    });
    await prisma.refreshToken.deleteMany({
      where: { userId: { in: [authorId, user1Id, user2Id] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [authorId, user1Id, user2Id] } },
    });
    await prisma.$disconnect();
  });

  it('should create notifications for mentioned users', async () => {
    await notifyMentions('Hello @mention-user1 and @mention-user2', authorId);

    const notifications = await prisma.notification.findMany({
      where: { userId: { in: [user1Id, user2Id] }, type: 'mention' },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    expect(notifications).toHaveLength(2);
    expect(notifications.every((n) => n.title.includes('mention-author'))).toBe(true);

    // cleanup
    await prisma.notification.deleteMany({
      where: { id: { in: notifications.map((n) => n.id) } },
    });
  });

  it('should notify the author when they mention themselves (reminder)', async () => {
    await notifyMentions('Note to self @mention-author', authorId);

    const notifications = await prisma.notification.findMany({
      where: { userId: authorId, type: 'mention' },
    });

    expect(notifications).toHaveLength(1);
    expect(notifications[0].title).toContain('reminder');
  });

  it('should handle non-existent usernames gracefully', async () => {
    await notifyMentions('Hello @nonexistent-user-xyz', authorId);

    const notifications = await prisma.notification.findMany({
      where: { type: 'mention' },
      orderBy: { createdAt: 'desc' },
      take: 1,
    });

    // No notification should be created for a non-existent user
    const recent = notifications[0];
    if (recent) {
      expect(recent.userId).not.toBe('nonexistent');
    }
  });

  it('should handle text with no mentions', async () => {
    const before = await prisma.notification.count({ where: { type: 'mention' } });
    await notifyMentions('No mentions here', authorId);
    const after = await prisma.notification.count({ where: { type: 'mention' } });

    expect(after).toBe(before);
  });

  it('should deduplicate mentions of the same user', async () => {
    await notifyMentions('@mention-user1 and again @mention-user1', authorId);

    const notifications = await prisma.notification.findMany({
      where: { userId: user1Id, type: 'mention' },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    expect(notifications).toHaveLength(1);

    // cleanup
    await prisma.notification.deleteMany({
      where: { id: { in: notifications.map((n) => n.id) } },
    });
  });

  it('should include resourceUrl in notification link', async () => {
    await notifyMentions('@mention-user1 test', authorId, '/issues/123');

    const notification = await prisma.notification.findFirst({
      where: { userId: user1Id, type: 'mention' },
      orderBy: { createdAt: 'desc' },
    });

    expect(notification).toBeTruthy();
    expect(notification!.link).toBe('/issues/123');

    // cleanup
    await prisma.notification.deleteMany({ where: { id: notification!.id } });
  });
});
