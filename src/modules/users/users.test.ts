import bcrypt from 'bcryptjs';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { prisma } from '../../config/database';
import app from '../../index';

describe('Users API', () => {
  let token: string;
  let tokenId: string;
  let apiToken: string;

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash('testpassword123', 4);

    await prisma.user.upsert({
      where: { username: 'users-test-user' },
      update: {},
      create: {
        email: 'users-test@axiom.dev',
        username: 'users-test-user',
        displayName: 'Users Test User',
        passwordHash,
      },
    });

    const loginRes = await request(app)
      .post('/api/auth/login')
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({
        login: 'users-test@axiom.dev',
        password: 'testpassword123',
      });
    token = loginRes.body.accessToken;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: 'users-test-user' } });
    await prisma.$disconnect();
  });

  // 1. Get /api/users/me
  it('1. should get current user profile', async () => {
    const res = await request(app).get('/api/users/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.email).toBe('users-test@axiom.dev');
    expect(res.body.username).toBe('users-test-user');
    expect(res.body.passwordHash).toBeUndefined();
  });

  // 2. Update profile
  it('2. should update displayName', async () => {
    const res = await request(app)
      .patch('/api/users/me')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ displayName: 'Updated User' });
    expect(res.status).toBe(200);
    expect(res.body.displayName).toBe('Updated User');
  });

  // 3. Create API token
  it('3. should create an API token', async () => {
    const res = await request(app)
      .post('/api/users/me/tokens')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ name: 'Test Token', scopes: ['repo:read'] });
    expect(res.status).toBe(201);
    expect(res.body.token).toBeDefined();
    expect(res.body.id).toBeDefined();
    apiToken = res.body.token;
    tokenId = res.body.id;
  });

  // 4. List tokens
  it('4. should list API tokens', async () => {
    const res = await request(app)
      .get('/api/users/me/tokens')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const found = res.body.find((t: { id: string }) => t.id === tokenId);
    expect(found).toBeDefined();
  });

  // 5. Use token for auth
  it('5. should use API token to authenticate a request', async () => {
    const res = await request(app).get('/api/users/me').set('Authorization', `Token ${apiToken}`);
    expect(res.status).toBe(200);
    expect(res.body.username).toBe('users-test-user');
  });

  // 6. Revoke token
  it('6. should revoke an API token', async () => {
    const res = await request(app)
      .delete(`/api/users/me/tokens/${tokenId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest');
    expect(res.status).toBe(204);
  });
});
