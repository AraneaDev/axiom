/**
 * The public form actions (plan 4): the limiter on a GET that carries a secret, the locked
 * answer, verify, and a credential that comes along over REST.
 */
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../../config/database';
import { env } from '../../config/env';
import app from '../../index';
import { cleanupTestContext, createTestContext, type TestContext } from '../../test/factory';
import { tokenHeaderFor } from '../../test/mcp-client';

import { hashAccessCode } from './form-secret';

const XHR = { 'X-Requested-With': 'XMLHttpRequest' };

describe('public form actions', () => {
  let ctx: TestContext;
  const stamp = Date.now();
  const gatedSlug = `pa-gated-${stamp}`;
  const openSlug = `pa-open-${stamp}`;
  const realEnv = env.NODE_ENV;

  beforeAll(async () => {
    ctx = await createTestContext(`pubact${stamp}`);
    const base = {
      projectId: ctx.projectId,
      createdById: ctx.owner.id,
      status: 'PUBLISHED' as const,
    };
    await prisma.form.create({
      data: {
        ...base,
        name: 'Gated',
        slug: gatedSlug,
        authMode: 'TOKEN_GATED',
        sharedSecret: hashAccessCode('open-sesame'),
      },
    });
    await prisma.form.create({ data: { ...base, name: 'Open', slug: openSlug } });
  });

  afterEach(() => {
    env.NODE_ENV = realEnv;
  });

  afterAll(async () => {
    await cleanupTestContext(ctx);
  });

  it('answers a gated form without its secret with the locked shape only', async () => {
    const res = await request(app).get(`/api/f/${gatedSlug}`);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['authMode', 'id', 'locked', 'name', 'slug']);
    const wrong = await request(app).get(`/api/f/${gatedSlug}`).set('X-Form-Secret', 'nope');
    expect(wrong.body.locked).toBe(true);
    const right = await request(app).get(`/api/f/${gatedSlug}`).set('X-Form-Secret', 'open-sesame');
    expect(right.body.locked).toBeUndefined();
    expect(JSON.stringify(right.body)).not.toContain('sha256:');
  });

  it('verifies a secret: right passes, wrong and missing answer 401, an open form passes', async () => {
    const verify = (slug: string, body: object) =>
      request(app).post(`/api/f/${slug}/verify`).set(XHR).send(body);
    const right = await verify(gatedSlug, { secret: 'open-sesame' });
    expect(right.status).toBe(200);
    expect(right.body).toEqual({ authorized: true, authMode: 'TOKEN_GATED' });
    expect((await verify(gatedSlug, { secret: 'wrong' })).status).toBe(401);
    expect((await verify(gatedSlug, {})).status).toBe(401);
    expect((await verify(openSlug, {})).body).toEqual({ authorized: true, authMode: 'PUBLIC' });
    expect((await verify('no-such-form', {})).status).toBe(404);
  });

  it('limits a GET that carries a secret per IP, and leaves one without alone', async () => {
    // The limiters skip under test; this one is switched on for the run
    env.NODE_ENV = 'production';
    const plain = [];
    for (let i = 0; i < 25; i++) plain.push((await request(app).get(`/api/f/${openSlug}`)).status);
    expect(plain.every((status) => status === 200)).toBe(true);

    const guesses = [];
    for (let i = 0; i < 22; i++) {
      guesses.push(
        await request(app).get(`/api/f/${gatedSlug}`).set('X-Form-Secret', 'open-sesame'),
      );
    }
    const refused = guesses.filter((res) => res.status === 429);
    expect(refused.length).toBeGreaterThan(0);
    expect(refused[0].body.error.code).toBe('RATE_LIMITED');
    expect(guesses[0].status).toBe(200);
  });

  it('reads no credential on a public route: a token sent along is still an anonymous call', async () => {
    const token = await tokenHeaderFor(ctx.owner, undefined, 'form-agent');
    const res = await request(app)
      .post(`/api/f/${openSlug}/submit`)
      .set('Authorization', token)
      .set(XHR)
      .send({ data: {} });
    expect(res.status).toBe(201);
    const row = await prisma.formSubmission.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(JSON.stringify(row)).not.toContain(ctx.owner.id);
  });

  it('writes the audit row of a public submission as a form, naming it by its path', async () => {
    const slug = `pa-audit-${stamp}`;
    await prisma.form.create({
      data: {
        projectId: ctx.projectId,
        createdById: ctx.owner.id,
        status: 'PUBLISHED',
        name: 'Audited',
        slug,
      },
    });
    const res = await request(app).post(`/api/f/${slug}/submit`).set(XHR).send({ data: {} });
    expect(res.status).toBe(201);
    const find = () =>
      prisma.auditLog.findFirst({
        where: { userId: null, details: { path: ['path'], string_contains: slug } },
      });
    let row = await find();
    for (let i = 0; i < 20 && !row; i++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      row = await find();
    }
    expect(row?.resource).toBe('form');
  });
});
