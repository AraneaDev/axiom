import bcrypt from 'bcryptjs';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { prisma } from '../../config/database';
import app from '../../index';

describe('Users API', () => {
  let token: string;
  let tokenId: string;
  let apiToken: string;
  let sshKeyId: string;

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

    const loginRes = await request(app).post('/api/auth/login').send({
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
  it('2. should update displayName and bio', async () => {
    const res = await request(app)
      .patch('/api/users/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ displayName: 'Updated User', bio: 'This is my bio' });
    expect(res.status).toBe(200);
    expect(res.body.displayName).toBe('Updated User');
    expect(res.body.bio).toBe('This is my bio');
  });

  // 3. Create API token
  it('3. should create an API token', async () => {
    const res = await request(app)
      .post('/api/users/me/tokens')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Test Token' });
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
    const res = await request(app).get('/api/users/me').set('Authorization', `Bearer ${apiToken}`);
    expect(res.status).toBe(200);
    expect(res.body.username).toBe('users-test-user');
  });

  // 6. Revoke token
  it('6. should revoke an API token', async () => {
    const res = await request(app)
      .delete(`/api/users/me/tokens/${tokenId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(204);
  });

  // 7. Add SSH key
  it('7. should add an SSH key', async () => {
    const res = await request(app)
      .post('/api/users/me/ssh-keys')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Test Key',
        publicKey: 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQC3test+key+data+here== test@example.com',
      });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    sshKeyId = res.body.id;
  });

  // 8. List SSH keys
  it('8. should list SSH keys', async () => {
    const res = await request(app)
      .get('/api/users/me/ssh-keys')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const found = res.body.find((k: { id: string }) => k.id === sshKeyId);
    expect(found).toBeDefined();
  });

  // 9. Delete SSH key
  it('9. should delete an SSH key', async () => {
    const res = await request(app)
      .delete(`/api/users/me/ssh-keys/${sshKeyId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(204);
  });
});
