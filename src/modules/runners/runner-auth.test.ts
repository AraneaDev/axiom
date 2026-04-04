import { randomUUID } from 'crypto';

import bcrypt from 'bcryptjs';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { createPrismaClient } from '../../config/database';

import { authenticateRunner, type RunnerRequest } from './runner-auth';

const prisma = createPrismaClient(process.env.DATABASE_URL);

function mockReq(headers: Record<string, string> = {}) {
  return { headers } as unknown as RunnerRequest;
}

function mockRes() {
  const res: Record<string, unknown> = {};
  res.statusCode = 200;
  res.status = (code: number) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body: unknown) => {
    res.body = body;
    return res;
  };
  return res as unknown as import('express').Response;
}

describe('authenticateRunner', () => {
  const uuid = randomUUID();
  const plainToken = 'test-runner-token-secret';
  let runnerId: string;

  beforeAll(async () => {
    const tokenHash = await bcrypt.hash(plainToken, 10);
    const runner = await prisma.runner.create({
      data: {
        uuid,
        name: 'test-runner',
        tokenHash,
        scopeType: 'ORG',
        scopeId: 'test-scope-id',
        labels: [],
      },
    });
    runnerId = runner.id;
  });

  afterAll(async () => {
    await prisma.runner.delete({ where: { id: runnerId } }).catch(() => {});
    await prisma.$disconnect();
  });

  it('returns 401 when X-Runner-UUID header is missing', async () => {
    const req = mockReq({ 'x-runner-token': plainToken });
    const res = mockRes();
    let nextCalled = false;
    await authenticateRunner(req, res, (() => {
      nextCalled = true;
    }) as unknown as import('express').NextFunction);

    expect((res as unknown as Record<string, unknown>).statusCode).toBe(401);
    expect((res as unknown as Record<string, unknown>).body).toEqual({
      error: { message: 'Missing runner credentials' },
    });
    expect(nextCalled).toBe(false);
  });

  it('returns 401 when X-Runner-Token header is missing', async () => {
    const req = mockReq({ 'x-runner-uuid': uuid });
    const res = mockRes();
    let nextCalled = false;
    await authenticateRunner(req, res, (() => {
      nextCalled = true;
    }) as unknown as import('express').NextFunction);

    expect((res as unknown as Record<string, unknown>).statusCode).toBe(401);
    expect((res as unknown as Record<string, unknown>).body).toEqual({
      error: { message: 'Missing runner credentials' },
    });
    expect(nextCalled).toBe(false);
  });

  it('returns 401 when runner UUID not found in database', async () => {
    const req = mockReq({
      'x-runner-uuid': randomUUID(),
      'x-runner-token': plainToken,
    });
    const res = mockRes();
    let nextCalled = false;
    await authenticateRunner(req, res, (() => {
      nextCalled = true;
    }) as unknown as import('express').NextFunction);

    expect((res as unknown as Record<string, unknown>).statusCode).toBe(401);
    expect((res as unknown as Record<string, unknown>).body).toEqual({
      error: { message: 'Unknown runner' },
    });
    expect(nextCalled).toBe(false);
  });

  it('returns 401 when token does not match', async () => {
    const req = mockReq({
      'x-runner-uuid': uuid,
      'x-runner-token': 'wrong-token',
    });
    const res = mockRes();
    let nextCalled = false;
    await authenticateRunner(req, res, (() => {
      nextCalled = true;
    }) as unknown as import('express').NextFunction);

    expect((res as unknown as Record<string, unknown>).statusCode).toBe(401);
    expect((res as unknown as Record<string, unknown>).body).toEqual({
      error: { message: 'Invalid runner token' },
    });
    expect(nextCalled).toBe(false);
  });

  it('calls next() and attaches runner to req on success', async () => {
    const req = mockReq({
      'x-runner-uuid': uuid,
      'x-runner-token': plainToken,
    });
    const res = mockRes();
    let nextCalled = false;
    await authenticateRunner(req, res, (() => {
      nextCalled = true;
    }) as unknown as import('express').NextFunction);

    expect(nextCalled).toBe(true);
    expect(req.runner).toBeDefined();
    expect(req.runner!.uuid).toBe(uuid);
    expect(req.runner!.name).toBe('test-runner');
    expect(req.runner!.scopeType).toBe('ORG');
    expect(req.runner!.scopeId).toBe('test-scope-id');
  });

  it('updates lastSeenAt on successful auth', async () => {
    const req = mockReq({
      'x-runner-uuid': uuid,
      'x-runner-token': plainToken,
    });
    const res = mockRes();
    await authenticateRunner(req, res, (() => {}) as unknown as import('express').NextFunction);

    const updated = await prisma.runner.findUnique({ where: { uuid } });
    expect(updated!.lastSeenAt).toBeTruthy();
  });
});
