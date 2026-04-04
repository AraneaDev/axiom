import crypto from 'crypto';

import bcrypt from 'bcryptjs';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { createPrismaClient } from '../../config/database';
import app from '../../index';

const prisma = createPrismaClient(process.env.DATABASE_URL);

// Track created IDs for cleanup
const createdRunnerIds: string[] = [];
const createdTokenIds: string[] = [];

afterAll(async () => {
  for (const id of createdRunnerIds) {
    await prisma.runner.delete({ where: { id } }).catch(() => {});
  }
  for (const id of createdTokenIds) {
    await prisma.runnerRegistrationToken.delete({ where: { id } }).catch(() => {});
  }
  await prisma.$disconnect();
});

async function createRegToken(overrides: { expiresAt?: Date; usedBy?: string } = {}) {
  const plain = crypto.randomBytes(16).toString('hex');
  const tokenHash = await bcrypt.hash(plain, 10);
  const token = await prisma.runnerRegistrationToken.create({
    data: {
      tokenHash,
      scopeType: 'ORG',
      scopeId: 'test-scope-id',
      expiresAt: overrides.expiresAt ?? new Date(Date.now() + 3600_000),
      usedBy: overrides.usedBy ?? null,
    },
  });
  createdTokenIds.push(token.id);
  return { plain, token };
}

describe('Connect-RPC Protocol', () => {
  describe('Ping', () => {
    it('returns { data: "Hello" }', async () => {
      const res = await request(app)
        .post('/api/actions/ping.v1.PingService/Ping')
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({});

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ data: 'Hello' });
    });
  });

  describe('Register', () => {
    it('registers a runner with a valid token', async () => {
      const { plain } = await createRegToken();

      const res = await request(app)
        .post('/api/actions/runner.v1.RunnerService/Register')
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          name: 'my-runner',
          token: plain,
          labels: ['linux', 'x64'],
          version: '0.1.0',
        });

      expect(res.status).toBe(200);
      expect(res.body.runner).toBeDefined();
      expect(res.body.runner.uuid).toBeTruthy();
      expect(res.body.runner.token).toBeTruthy();
      expect(res.body.runner.name).toBe('my-runner');

      // Track for cleanup
      const runner = await prisma.runner.findUnique({ where: { uuid: res.body.runner.uuid } });
      if (runner) createdRunnerIds.push(runner.id);
    });

    it('rejects an expired registration token', async () => {
      const { plain } = await createRegToken({
        expiresAt: new Date(Date.now() - 60_000),
      });

      const res = await request(app)
        .post('/api/actions/runner.v1.RunnerService/Register')
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          name: 'expired-runner',
          token: plain,
          labels: [],
          version: '0.1.0',
        });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/invalid or expired/i);
    });

    it('rejects an already-used registration token', async () => {
      const { plain } = await createRegToken();

      // First registration should succeed
      const res1 = await request(app)
        .post('/api/actions/runner.v1.RunnerService/Register')
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          name: 'first-runner',
          token: plain,
          labels: [],
          version: '0.1.0',
        });
      expect(res1.status).toBe(200);

      const runner = await prisma.runner.findUnique({ where: { uuid: res1.body.runner.uuid } });
      if (runner) createdRunnerIds.push(runner.id);

      // Second registration with same token should fail
      const res2 = await request(app)
        .post('/api/actions/runner.v1.RunnerService/Register')
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          name: 'second-runner',
          token: plain,
          labels: [],
          version: '0.1.0',
        });

      expect(res2.status).toBe(400);
      expect(res2.body.error.message).toMatch(/invalid or expired/i);
    });
  });

  describe('Declare', () => {
    let runnerUuid: string;
    let runnerToken: string;

    beforeAll(async () => {
      const { plain } = await createRegToken();

      const res = await request(app)
        .post('/api/actions/runner.v1.RunnerService/Register')
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          name: 'declare-runner',
          token: plain,
          labels: ['linux'],
          version: '0.0.1',
        });

      runnerUuid = res.body.runner.uuid;
      runnerToken = res.body.runner.token;

      const runner = await prisma.runner.findUnique({ where: { uuid: runnerUuid } });
      if (runner) createdRunnerIds.push(runner.id);
    });

    it('updates version and labels on Declare', async () => {
      const res = await request(app)
        .post('/api/actions/runner.v1.RunnerService/Declare')
        .set('X-Runner-UUID', runnerUuid)
        .set('X-Runner-Token', runnerToken)
        .send({
          version: '1.0.0',
          labels: ['linux', 'docker', 'x64'],
        });

      expect(res.status).toBe(200);
      expect(res.body.runner.uuid).toBe(runnerUuid);
      expect(res.body.runner.name).toBe('declare-runner');
      expect(res.body.runner.status).toBe('IDLE');

      // Verify in DB
      const updated = await prisma.runner.findUnique({ where: { uuid: runnerUuid } });
      expect(updated!.version).toBe('1.0.0');
      expect(updated!.labels).toEqual(['linux', 'docker', 'x64']);
    });

    it('returns 401 without auth headers', async () => {
      const res = await request(app).post('/api/actions/runner.v1.RunnerService/Declare').send({
        version: '1.0.0',
        labels: [],
      });

      expect(res.status).toBe(401);
    });
  });
});
