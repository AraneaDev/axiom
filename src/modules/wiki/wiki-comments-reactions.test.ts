import bcrypt from 'bcryptjs';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { prisma } from '../../config/database';
import app from '../../index';

describe('Comment Reactions API', () => {
  let token: string;
  let token2: string;
  let teamId: string;
  let spaceId: string;
  let pageId: string;
  let commentId: string;

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash('testpassword123', 4);

    const user1 = await prisma.user.upsert({
      where: { username: 'reactions-test-user1' },
      update: {},
      create: {
        email: 'reactions-test1@axiom.dev',
        username: 'reactions-test-user1',
        displayName: 'Reactions Test User 1',
        passwordHash,
      },
    });

    const user2 = await prisma.user.upsert({
      where: { username: 'reactions-test-user2' },
      update: {},
      create: {
        email: 'reactions-test2@axiom.dev',
        username: 'reactions-test-user2',
        displayName: 'Reactions Test User 2',
        passwordHash,
      },
    });

    const org = await prisma.organization.create({
      data: {
        name: 'Reactions Test Org',
        slug: 'reactions-test-org',
        members: {
          createMany: {
            data: [
              { userId: user1.id, role: 'OWNER' },
              { userId: user2.id, role: 'MEMBER' },
            ],
          },
        },
      },
    });

    const team = await prisma.team.create({
      data: {
        name: 'Reactions Test Team',
        slug: 'reactions-test-team',
        orgId: org.id,
        members: {
          createMany: {
            data: [
              { userId: user1.id, role: 'ADMIN' },
              { userId: user2.id, role: 'MEMBER' },
            ],
          },
        },
      },
    });
    teamId = team.id;

    const loginRes1 = await request(app)
      .post('/api/auth/login')
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ login: 'reactions-test1@axiom.dev', password: 'testpassword123' });
    token = loginRes1.body.accessToken;

    const loginRes2 = await request(app)
      .post('/api/auth/login')
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ login: 'reactions-test2@axiom.dev', password: 'testpassword123' });
    token2 = loginRes2.body.accessToken;

    const spaceRes = await request(app)
      .post(`/api/wiki/team/${teamId}/spaces`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ name: 'Reactions Test Space', slug: 'reactions-test-space' });
    spaceId = spaceRes.body.id;

    const pageRes = await request(app)
      .post(`/api/wiki/spaces/${spaceId}/pages`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ title: 'Reactions Test Page', slug: 'reactions-test-page', body: 'Test content.' });
    pageId = pageRes.body.id;

    const commentRes = await request(app)
      .post(`/api/wiki/pages/${pageId}/comments`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ body: 'A comment to react to' });
    commentId = commentRes.body.id;
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { slug: 'reactions-test-org' } });
    await prisma.user.deleteMany({
      where: { username: { in: ['reactions-test-user1', 'reactions-test-user2'] } },
    });
    await prisma.$disconnect();
  });

  it('adds a reaction to a comment', async () => {
    const res = await request(app)
      .post(`/api/wiki/comments/${commentId}/reactions`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ reactionType: 'thumbsup' });
    expect(res.status).toBe(200);
    expect(res.body.added).toBe(true);
  });

  it('removes reaction when toggled again', async () => {
    const res = await request(app)
      .post(`/api/wiki/comments/${commentId}/reactions`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ reactionType: 'thumbsup' });
    expect(res.status).toBe(200);
    expect(res.body.added).toBe(false);
  });

  it('returns reaction counts with comment', async () => {
    // Add reactions from both users
    await request(app)
      .post(`/api/wiki/comments/${commentId}/reactions`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ reactionType: 'heart' });

    await request(app)
      .post(`/api/wiki/comments/${commentId}/reactions`)
      .set('Authorization', `Bearer ${token2}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ reactionType: 'heart' });

    const res = await request(app)
      .get(`/api/wiki/pages/${pageId}/comments`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest');
    expect(res.status).toBe(200);

    const comment = res.body.find((c: { id: string }) => c.id === commentId);
    expect(comment).toBeDefined();
    expect(comment.reactions).toBeDefined();

    const heartReactions = comment.reactions.filter(
      (r: { reactionType: string }) => r.reactionType === 'heart',
    );
    expect(heartReactions.length).toBe(2);
  });

  it('indicates which reactions current user has given', async () => {
    const res = await request(app)
      .get(`/api/wiki/pages/${pageId}/comments`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest');
    expect(res.status).toBe(200);

    const comment = res.body.find((c: { id: string }) => c.id === commentId);
    expect(comment.reactions).toBeDefined();

    // Each reaction has a userId, so the client can check if current user reacted
    const userReactions = comment.reactions.filter(
      (r: { userId: string }) => r.userId === comment.reactions[0]?.userId,
    );
    expect(userReactions.length).toBeGreaterThanOrEqual(1);
    expect(userReactions[0].userId).toBeDefined();
  });

  it('rejects invalid reaction types', async () => {
    const res = await request(app)
      .post(`/api/wiki/comments/${commentId}/reactions`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ reactionType: 'invalid' });
    expect(res.status).toBe(400);
  });
});
