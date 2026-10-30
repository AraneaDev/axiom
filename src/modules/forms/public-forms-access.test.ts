/**
 * Token-gated forms reveal their structure and accept submissions only with the secret,
 * and rateLimitPerHour caps submissions per IP.
 */
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../../config/database';
import app from '../../index';
import { cleanupTestContext, createTestContext, type TestContext } from '../../test/factory';

describe('Public form access', () => {
  let ctx: TestContext;
  const gatedSlug = `gated-${Date.now()}`;
  const limitedSlug = `limited-${Date.now()}`;
  const SECRET_FIELD = `Secret question ${Date.now()}`;
  const pub = (method: 'get' | 'post', path: string) =>
    request(app)[method](`/api${path}`).set('X-Requested-With', 'XMLHttpRequest');

  beforeAll(async () => {
    ctx = await createTestContext(`pubform${Date.now()}`);
    const gated = await prisma.form.create({
      data: {
        projectId: ctx.projectId,
        name: 'Gated',
        slug: gatedSlug,
        createdById: ctx.owner.id,
        status: 'PUBLISHED',
        authMode: 'TOKEN_GATED',
        sharedSecret: await bcrypt.hash('open-sesame', 4),
      },
    });
    const page = await prisma.formPage.create({
      data: { formId: gated.id, title: 'P1', position: 0 },
    });
    await prisma.formField.create({
      data: { formPageId: page.id, position: 0, type: 'TEXT', label: SECRET_FIELD },
    });
    await prisma.form.create({
      data: {
        projectId: ctx.projectId,
        name: 'Limited',
        slug: limitedSlug,
        createdById: ctx.owner.id,
        status: 'PUBLISHED',
        rateLimitPerHour: 2,
      },
    });
  });

  afterAll(async () => {
    await cleanupTestContext(ctx);
  });

  it('hides a gated form and refuses submissions without the secret', async () => {
    const noSecret = await pub('get', `/f/${gatedSlug}`);
    expect(noSecret.status).toBe(200);
    expect(noSecret.body.authMode).toBe('TOKEN_GATED');
    expect(JSON.stringify(noSecret.body)).not.toContain(SECRET_FIELD);

    const withSecret = await pub('get', `/f/${gatedSlug}`).set('X-Form-Secret', 'open-sesame');
    expect(JSON.stringify(withSecret.body)).toContain(SECRET_FIELD);

    const submitNoSecret = await pub('post', `/f/${gatedSlug}/submit`).send({ data: { a: 1 } });
    const submitWrong = await pub('post', `/f/${gatedSlug}/submit`).send({
      data: { a: 1 },
      secret: 'wrong',
    });
    expect([submitNoSecret.status, submitWrong.status]).toEqual([401, 401]);
    const ok = await pub('post', `/f/${gatedSlug}/submit`).send({
      data: { a: 1 },
      secret: 'open-sesame',
    });
    expect(ok.status).toBe(201);
  });

  it('enforces rateLimitPerHour per IP', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 3; i++) {
      statuses.push((await pub('post', `/f/${limitedSlug}/submit`).send({ data: { i } })).status);
    }
    expect(statuses).toEqual([201, 201, 429]);
  });
});
