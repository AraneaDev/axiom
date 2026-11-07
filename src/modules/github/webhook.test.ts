import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import net from 'node:net';
import path from 'node:path';

import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '../../config/database';
import app from '../../index';
import { githubWebhookLimiter, globalLimiter, rateLimitTesting } from '../../middleware/rate-limit';
import { seedGithubApp } from '../../test/github-seed';
import { postWebhook } from '../../test/github-webhook';
import { listenForRawRequests } from '../../test/raw-request';

import { deleteApp } from './github-app.service';
import { onGithubEvent, registeredGithubEvents } from './webhook-dispatch';
import { cleanupDeliveries, processDelivery, retryDueDeliveries } from './webhook.service';

const URL = '/api/github/webhook';
let secret: string;
/** Event names are unique per test: handlers stay registered for the whole file */
const eventName = () => `t_${randomUUID().slice(0, 8)}`;
const settle = () => new Promise((resolve) => setTimeout(resolve, 100));
const row = (id: string) => prisma.githubDelivery.findUnique({ where: { id } });

beforeAll(async () => {
  secret = (await seedGithubApp()).webhookSecret;
});

beforeEach(async () => {
  // Tests place deliveries at fixed times: the App is older than all of them
  await prisma.githubApp.updateMany({ data: { createdAt: new Date(0) } });
  await prisma.githubDelivery.deleteMany();
  await prisma.githubInstallation.deleteMany();
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(async () => {
  await prisma.githubDelivery.deleteMany();
  await prisma.githubInstallation.deleteMany();
  await deleteApp().catch(() => undefined);
});

describe('signature', () => {
  it('accepts a body signed over its exact bytes, whatever the spacing and order', async () => {
    const event = eventName();
    const handler = vi.fn(async () => 'processed' as const);
    onGithubEvent(event, handler);
    const res = await postWebhook(event, null, { rawBody: '{"b": 1,  "a":2}', deliveryId: 'd-1' });
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ accepted: true });
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
    expect(handler.mock.calls[0][0].payload).toEqual({ a: 2, b: 1 });
    expect(handler.mock.calls[0][0]).toMatchObject({ deliveryId: 'd-1', event, action: null });
  });

  it('refuses a body with one changed byte and writes nothing', async () => {
    const body = '{"b": 1,  "a":2}';
    const signature = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
    const res = await request(app)
      .post(URL)
      .set('Content-Type', 'application/json')
      .set('X-GitHub-Event', 'push')
      .set('X-GitHub-Delivery', 'd-tampered')
      .set('X-Hub-Signature-256', signature)
      .send('{"b": 1,  "a":3}');
    expect(res.status).toBe(401);
    expect(await prisma.githubDelivery.count()).toBe(0);
  });

  it('refuses a missing, malformed or wrongly signed header', async () => {
    const send = (signature?: string) => {
      const req = request(app)
        .post(URL)
        .set('Content-Type', 'application/json')
        .set('X-GitHub-Event', 'push')
        .set('X-GitHub-Delivery', 'd-sig');
      return (signature === undefined ? req : req.set('X-Hub-Signature-256', signature)).send('{}');
    };
    expect((await send()).status).toBe(401);
    expect((await send('sha256=abc')).status).toBe(401);
    expect((await send('sha1=' + 'a'.repeat(64))).status).toBe(401);
    expect((await postWebhook('push', {}, { secret: 'another-secret' })).status).toBe(401);
    expect(await prisma.githubDelivery.count()).toBe(0);
  });

  it('answers 404 when no App is set up, before it reads anything', async () => {
    await deleteApp();
    try {
      const res = await postWebhook('push', {}, { secret });
      expect(res.status).toBe(404);
      expect(await prisma.githubDelivery.count()).toBe(0);
    } finally {
      secret = (await seedGithubApp()).webhookSecret;
    }
  });

  it('needs no CSRF header and no sign-in', async () => {
    const res = await postWebhook('ping', { zen: 'Keep it logically awesome.' });
    expect(res.status).toBe(202);
  });

  it('answers 400 to a signed body without a delivery id or an event', async () => {
    const body = '{}';
    const signature = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
    const base = () =>
      request(app)
        .post(URL)
        .set('Content-Type', 'application/json')
        .set('X-Hub-Signature-256', signature);
    expect((await base().set('X-GitHub-Event', 'push').send(body)).status).toBe(400);
    expect((await base().set('X-GitHub-Delivery', 'd-x').send(body)).status).toBe(400);
    expect(await prisma.githubDelivery.count()).toBe(0);
  });

  it('answers 400 to a signed body that is not a JSON object', async () => {
    const res = await postWebhook('push', null, { rawBody: '[1,2]' });
    expect(res.status).toBe(400);
    expect((await postWebhook('push', null, { rawBody: 'nope' })).status).toBe(400);
    expect(await prisma.githubDelivery.count()).toBe(0);
  });

  it('refuses a body over 25 MB with 413', async () => {
    const big = Buffer.alloc(26 * 1024 * 1024, 0x61);
    const res = await request(app)
      .post(URL)
      .set('Content-Type', 'application/json')
      .set('X-GitHub-Event', 'push')
      .set('X-GitHub-Delivery', 'd-big')
      .set('X-Hub-Signature-256', 'sha256=' + '0'.repeat(64))
      .send(big);
    expect(res.status).toBe(413);
    expect(await prisma.githubDelivery.count()).toBe(0);
  });
});

describe('ids above 2^31', () => {
  it('stores an installation and a repository id that int4 could not hold', async () => {
    const event = eventName();
    const res = await postWebhook(
      event,
      {
        action: 'opened',
        installation: { id: 3_100_000_000 },
        repository: { id: 9_007_199_254_740_000 },
      },
      { deliveryId: 'd-big' },
    );
    expect(res.status).toBe(202);
    expect(await row('d-big')).toMatchObject({
      installationId: 3_100_000_000n,
      repoId: 9_007_199_254_740_000n,
    });
  });
});

describe('the delivery log', () => {
  it('stores a ping as IGNORED and runs nothing', async () => {
    const res = await postWebhook('ping', { zen: 'x' }, { deliveryId: 'd-ping' });
    expect(res.status).toBe(202);
    const stored = await row('d-ping');
    expect(stored).toMatchObject({ status: 'IGNORED', event: 'ping', attempts: 0 });
    expect(stored?.processedAt).not.toBeNull();
  });

  it('keeps event, action, installation and repository of the payload', async () => {
    const event = eventName();
    await postWebhook(
      event,
      { action: 'opened', installation: { id: 77 }, repository: { id: 4242 } },
      { deliveryId: 'd-fields' },
    );
    expect(await row('d-fields')).toMatchObject({
      event,
      action: 'opened',
      installationId: 77n,
      repoId: 4242n,
    });
  });

  it('answers a delivery id it has already stored with duplicate, and runs the handler once', async () => {
    const event = eventName();
    const handler = vi.fn(async () => 'processed' as const);
    onGithubEvent(event, handler);
    const first = await postWebhook(event, { n: 1 }, { deliveryId: 'd-dup' });
    const second = await postWebhook(event, { n: 1 }, { deliveryId: 'd-dup' });
    expect(first.status).toBe(202);
    expect(second.status).toBe(200);
    expect(second.body).toEqual({ duplicate: true });
    await settle();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(await prisma.githubDelivery.count()).toBe(1);
  });

  it('counts parallel deliveries of one id as one, with no error', async () => {
    const event = eventName();
    const handler = vi.fn(async () => 'processed' as const);
    onGithubEvent(event, handler);
    const answers = await Promise.all(
      Array.from({ length: 6 }, () => postWebhook(event, { n: 1 }, { deliveryId: 'd-race' })),
    );
    expect(answers.filter((r) => r.status === 202)).toHaveLength(1);
    expect(answers.filter((r) => r.body.duplicate === true)).toHaveLength(5);
    await settle();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('marks a delivery nobody handles IGNORED and one that is handled PROCESSED', async () => {
    const handled = eventName();
    onGithubEvent(handled, async () => 'processed');
    const skipped = eventName();
    onGithubEvent(skipped, async () => 'ignored');
    await postWebhook(handled, {}, { deliveryId: 'd-handled' });
    await postWebhook(skipped, {}, { deliveryId: 'd-skipped' });
    await postWebhook(eventName(), {}, { deliveryId: 'd-nobody' });
    await vi.waitFor(async () => {
      expect((await row('d-handled'))?.status).toBe('PROCESSED');
      expect((await row('d-skipped'))?.status).toBe('IGNORED');
      expect((await row('d-nobody'))?.status).toBe('IGNORED');
    });
    expect((await row('d-handled'))?.attempts).toBe(1);
  });

  it('runs several handlers of an event in registration order', async () => {
    const event = eventName();
    const order: string[] = [];
    onGithubEvent(event, async () => {
      order.push('first');
      return 'ignored';
    });
    onGithubEvent(event, async () => {
      order.push('second');
      return 'processed';
    });
    await postWebhook(event, {}, { deliveryId: 'd-order' });
    await vi.waitFor(async () => expect((await row('d-order'))?.status).toBe('PROCESSED'));
    expect(order).toEqual(['first', 'second']);
  });
});

describe('before the body is read', () => {
  const big = () => Buffer.alloc(26 * 1024 * 1024, 0x61);
  const goodSignature = 'sha256=' + '0'.repeat(64);
  const send = (headers: Record<string, string>) => {
    let req = request(app).post(URL).set('Content-Type', 'application/json');
    for (const [name, value] of Object.entries(headers)) req = req.set(name, value);
    return req.send(big());
  };
  const full = {
    'X-GitHub-Event': 'push',
    'X-GitHub-Delivery': 'd-gate',
    'X-Hub-Signature-256': goodSignature,
  };

  it('answers 404 to an oversized body when no App is set up, not 413', async () => {
    await deleteApp();
    try {
      expect((await send(full)).status).toBe(404);
    } finally {
      secret = (await seedGithubApp()).webhookSecret;
    }
  });

  it('answers 401, not 413, to an oversized body with a missing or malformed signature', async () => {
    const { 'X-Hub-Signature-256': _gone, ...without } = full;
    expect((await send(without)).status).toBe(401);
    expect((await send({ ...full, 'X-Hub-Signature-256': 'sha256=zz' })).status).toBe(401);
  });

  it('answers 400, not 413, to an oversized body without an event or delivery id', async () => {
    const { 'X-GitHub-Event': _event, ...noEvent } = full;
    const { 'X-GitHub-Delivery': _delivery, ...noDelivery } = full;
    expect((await send(noEvent)).status).toBe(400);
    expect((await send(noDelivery)).status).toBe(400);
  });

  it('counts a flood against the limiter before the gate looks at it', async () => {
    rateLimitTesting.enforce = true;
    try {
      for (const key of ['::ffff:127.0.0.1', '127.0.0.1', '::1']) {
        await githubWebhookLimiter.resetKey(key);
      }
      const statuses = await flood(1001);
      expect(statuses.filter((status) => status === 429)).toHaveLength(1);
      // Refused before the gate: 401 for the first 1000, never a body read
      expect(statuses.filter((status) => status === 401)).toHaveLength(1000);
    } finally {
      for (const key of ['::ffff:127.0.0.1', '127.0.0.1', '::1']) {
        await githubWebhookLimiter.resetKey(key);
      }
      rateLimitTesting.enforce = false;
    }
  }, 60_000);
});

describe('the gate and the payload', () => {
  it('answers 405 with Allow: POST to anything but a POST, before the body is read', async () => {
    // The head claims 25 MB and none is ever sent: only an answer given before the body is read
    // can come back
    const server = await listenForRawRequests(app);
    try {
      const { port } = server.address() as AddressInfo;
      for (const method of ['PUT', 'PATCH', 'DELETE', 'GET']) {
        const answer = await new Promise<string>((resolve, reject) => {
          const socket = net.connect(port, '127.0.0.1', () => {
            socket.write(
              `${method} ${URL} HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\n` +
                `Content-Length: ${25 * 1024 * 1024}\r\nConnection: close\r\n\r\n{`,
            );
          });
          let data = '';
          socket.on('data', (chunk) => {
            data += chunk.toString();
            if (data.includes('\r\n\r\n')) {
              socket.destroy();
              resolve(data);
            }
          });
          socket.on('error', reject);
        });
        expect(answer).toMatch(/^HTTP\/1\.1 405/);
        expect(answer.toLowerCase()).toContain('allow: post');
      }
    } finally {
      server.close();
    }
  }, 5000);

  it('stores lone surrogates as U+FFFD and keeps a valid pair', async () => {
    const res = await postWebhook(eventName(), null, {
      deliveryId: 'd-surrogate',
      rawBody:
        '{"hi":"a\\ud83db","lo":"a\\ude00b","pair":"\\ud83d\\ude00","two":"\\ud83d\\ud83d\\ude00"}',
    });
    expect(res.status).toBe(202);
    expect((await row('d-surrogate'))?.payload).toEqual({
      hi: 'a\uFFFDb',
      lo: 'a\uFFFDb',
      pair: '\u{1F600}',
      two: '\uFFFD\u{1F600}',
    });
  });

  it('stores the delivery without a payload when Postgres refuses its text, and logs it', async () => {
    const refusal = Object.assign(new Error('unsupported Unicode escape sequence'), {
      cause: { kind: 'postgres', originalCode: '22P05' },
    });
    const create = vi.spyOn(prisma.githubDelivery, 'create').mockRejectedValueOnce(refusal);
    try {
      const res = await postWebhook(eventName(), {}, { deliveryId: 'd-refused' });
      expect(res.status).toBe(202);
    } finally {
      create.mockRestore();
    }
    expect(await row('d-refused')).toMatchObject({
      status: 'FAILED',
      payload: null,
      error: 'payload could not be stored',
      nextAttemptAt: null,
    });
  });

  it('sees the SQLSTATE under a Prisma P2007 error, as a lone surrogate throws it', async () => {
    const refusal = Object.assign(new Error('invalid input syntax for type json'), {
      code: 'P2007',
      meta: { driverAdapterError: { cause: { kind: 'postgres', originalCode: '22P02' } } },
    });
    const create = vi.spyOn(prisma.githubDelivery, 'create').mockRejectedValueOnce(refusal);
    try {
      const res = await postWebhook(eventName(), {}, { deliveryId: 'd-refused-p2007' });
      expect(res.status).toBe(202);
    } finally {
      create.mockRestore();
    }
    expect(await row('d-refused-p2007')).toMatchObject({
      status: 'FAILED',
      payload: null,
      error: 'payload could not be stored',
    });
  });

  it('answers 500 and stores nothing for any other database error', async () => {
    const create = vi
      .spyOn(prisma.githubDelivery, 'create')
      .mockRejectedValueOnce(new Error('connection terminated'));
    try {
      const res = await postWebhook(eventName(), {}, { deliveryId: 'd-fault' });
      expect(res.status).toBe(500);
    } finally {
      create.mockRestore();
    }
    expect(await row('d-fault')).toBeNull();
  });
});

describe('handler registry', () => {
  it('registers the installation events in one module that both processes import', () => {
    expect(registeredGithubEvents()).toEqual(
      expect.arrayContaining(['installation', 'installation_repositories']),
    );
    const root = path.join(__dirname, '../..');
    for (const entry of ['index.ts', 'worker.ts']) {
      expect(readFileSync(path.join(root, entry), 'utf8')).toContain(
        './modules/github/webhook-handlers',
      );
    }
    // The service registers nothing itself, so a process cannot see a different set
    expect(readFileSync(path.join(__dirname, 'webhook.service.ts'), 'utf8')).not.toContain(
      'onGithubEvent(',
    );
  });
});

describe('stuck and replayed deliveries', () => {
  it('ends a delivery whose 5th attempt never finished: FAILED, no retry, with the reason', async () => {
    await prisma.githubDelivery.create({
      data: {
        id: 'd-stuck',
        event: 'push',
        payload: {},
        status: 'PENDING',
        attempts: 5,
        nextAttemptAt: new Date(Date.now() - 1000),
      },
    });
    await prisma.githubDelivery.create({
      data: {
        id: 'd-running',
        event: 'push',
        payload: {},
        status: 'PENDING',
        attempts: 5,
        nextAttemptAt: new Date(Date.now() + 4 * 60_000),
      },
    });
    await retryDueDeliveries();
    expect(await row('d-stuck')).toMatchObject({
      status: 'FAILED',
      nextAttemptAt: null,
      error: 'gave up after 5 attempts',
    });
    expect((await row('d-running'))?.status).toBe('PENDING');
  });

  it('runs a redelivery of a finally failed delivery again, and answers other duplicates as before', async () => {
    const event = eventName();
    const handler = vi.fn(async () => 'processed' as const);
    onGithubEvent(event, handler);
    await prisma.githubDelivery.create({
      data: { id: 'd-redo', event, payload: {}, status: 'FAILED', attempts: 5, error: 'x' },
    });
    const again = await postWebhook(event, { n: 2 }, { deliveryId: 'd-redo' });
    expect(again.status).toBe(202);
    await vi.waitFor(async () => expect((await row('d-redo'))?.status).toBe('PROCESSED'));
    expect(await row('d-redo')).toMatchObject({ attempts: 1, error: null });
    expect(handler).toHaveBeenCalledTimes(1);
    // Now processed: a second redelivery is a plain duplicate
    expect((await postWebhook(event, { n: 2 }, { deliveryId: 'd-redo' })).body).toEqual({
      duplicate: true,
    });
    // A failed one that still has a retry time is a duplicate too
    await prisma.githubDelivery.create({
      data: {
        id: 'd-soon',
        event,
        payload: {},
        status: 'FAILED',
        attempts: 1,
        nextAttemptAt: new Date(Date.now() + 60_000),
      },
    });
    expect((await postWebhook(event, {}, { deliveryId: 'd-soon' })).body).toEqual({
      duplicate: true,
    });
  });

  it('does not let a stale run overwrite a delivery that another run has claimed since', async () => {
    const event = eventName();
    onGithubEvent(event, async () => {
      await prisma.githubDelivery.update({ where: { id: 'd-stale' }, data: { attempts: 4 } });
      return 'processed';
    });
    await prisma.githubDelivery.create({ data: { id: 'd-stale', event, payload: {} } });
    await processDelivery('d-stale');
    expect((await row('d-stale'))?.status).toBe('PENDING');
  });
});

describe('a NUL in the payload', () => {
  it('is stored with the character replaced, and a literal backslash text is kept', async () => {
    const event = eventName();
    const res = await postWebhook(event, null, {
      deliveryId: 'd-nul',
      rawBody: '{"a":"x\\u0000y","b":"p\\\\u0000q","k\\u0000":1}',
    });
    expect(res.status).toBe(202);
    expect((await row('d-nul'))?.payload).toEqual({
      a: 'x\uFFFDy',
      b: 'p\\u0000q',
      'k\uFFFD': 1,
    });
  });
});

describe('retries', () => {
  it('fails once, waits a minute and succeeds on the retry', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-06T10:00:00Z'));
    const event = eventName();
    const handler = vi
      .fn<() => Promise<'processed'>>()
      .mockRejectedValueOnce(new Error('GitHub is down'))
      .mockResolvedValue('processed');
    onGithubEvent(event, handler);
    await postWebhook(event, {}, { deliveryId: 'd-retry' });
    await vi.waitFor(async () => expect((await row('d-retry'))?.status).toBe('FAILED'));
    const failed = await row('d-retry');
    expect(failed).toMatchObject({ attempts: 1, error: 'GitHub is down' });
    expect(
      Math.abs(failed!.nextAttemptAt!.getTime() - Date.parse('2026-11-06T10:01:00Z')),
    ).toBeLessThan(2000);

    expect(await retryDueDeliveries()).toBe(0);
    vi.setSystemTime(new Date('2026-11-06T10:01:01Z'));
    expect(await retryDueDeliveries()).toBe(1);
    expect(await row('d-retry')).toMatchObject({ status: 'PROCESSED', attempts: 2 });
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('backs off 1, 5, 15 and 60 minutes, then gives up after five attempts', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const start = new Date('2026-11-06T10:00:00Z');
    vi.setSystemTime(start);
    const event = eventName();
    const handler = vi.fn(async (): Promise<'processed'> => {
      throw new Error('still down');
    });
    onGithubEvent(event, handler);
    await postWebhook(event, {}, { deliveryId: 'd-giveup' });
    await vi.waitFor(async () => expect((await row('d-giveup'))?.attempts).toBe(1));
    await vi.waitFor(async () => expect((await row('d-giveup'))?.status).toBe('FAILED'));
    const minutes: Array<number | null> = [];
    for (let attempt = 1; attempt <= 5; attempt++) {
      const stored = await row('d-giveup');
      expect(stored?.attempts).toBe(attempt);
      const next = stored?.nextAttemptAt;
      minutes.push(next ? Math.round((next.getTime() - Date.now()) / 60_000) : null);
      if (!next) break;
      vi.setSystemTime(new Date(next.getTime() + 1000));
      await retryDueDeliveries();
    }
    expect(minutes).toEqual([1, 5, 15, 60, null]);
    const final = await row('d-giveup');
    expect(final).toMatchObject({ status: 'FAILED', attempts: 5, nextAttemptAt: null });
    // Nothing picks it up again
    vi.setSystemTime(new Date(start.getTime() + 24 * 3600_000));
    expect(await retryDueDeliveries()).toBe(0);
    await processDelivery('d-giveup');
    expect(handler).toHaveBeenCalledTimes(5);
  });

  it('runs the handler once when two workers claim the same delivery', async () => {
    const event = eventName();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const handler = vi.fn(async () => {
      await gate;
      return 'processed' as const;
    });
    onGithubEvent(event, handler);
    await prisma.githubDelivery.create({
      data: { id: 'd-claim', event, payload: {}, status: 'PENDING' },
    });
    const both = Promise.all([processDelivery('d-claim'), processDelivery('d-claim')]);
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
    release();
    await both;
    expect(handler).toHaveBeenCalledTimes(1);
    expect(await row('d-claim')).toMatchObject({ status: 'PROCESSED', attempts: 1 });
  });

  it('leases a claimed delivery for five minutes, so a crashed worker is retried later', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-06T10:00:00Z'));
    const event = eventName();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    onGithubEvent(event, async () => {
      await gate;
      return 'processed';
    });
    await prisma.githubDelivery.create({ data: { id: 'd-lease', event, payload: {} } });
    const running = processDelivery('d-lease');
    await vi.waitFor(async () => {
      const lease = (await row('d-lease'))?.nextAttemptAt;
      expect(Math.abs((lease?.getTime() ?? 0) - Date.parse('2026-11-06T10:05:00Z'))).toBeLessThan(
        2000,
      );
    });
    expect(await retryDueDeliveries()).toBe(0);
    release();
    await running;
  });

  it('retries a delivery that stayed pending because the process died after storing it', async () => {
    const event = eventName();
    const handler = vi.fn(async () => 'processed' as const);
    onGithubEvent(event, handler);
    await prisma.githubDelivery.create({
      data: { id: 'd-lost', event, payload: {}, receivedAt: new Date(Date.now() - 5 * 60_000) },
    });
    expect(await retryDueDeliveries()).toBe(1);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('stores the message only, cut to 500 characters, with no webhook secret in it', async () => {
    const event = eventName();
    onGithubEvent(event, async () => {
      throw new Error(`boom ${secret} ${'x'.repeat(600)}`);
    });
    await postWebhook(event, {}, { deliveryId: 'd-secret' });
    await vi.waitFor(async () => expect((await row('d-secret'))?.status).toBe('FAILED'));
    const { error } = (await row('d-secret'))!;
    expect(error).not.toContain(secret);
    expect(error!.length).toBeLessThanOrEqual(500);
    expect(error).toMatch(/^boom /);
  });

  it('scrubs a secret that the cut would have split', async () => {
    const event = eventName();
    onGithubEvent(event, async () => {
      throw new Error(`${'y'.repeat(490)}${secret}`);
    });
    await postWebhook(event, {}, { deliveryId: 'd-split' });
    await vi.waitFor(async () => expect((await row('d-split'))?.status).toBe('FAILED'));
    const { error } = (await row('d-split'))!;
    expect(error).not.toContain(secret.slice(0, 8));
  });
});

describe('cleanup', () => {
  it('clears payloads after 7 days on finished and failed rows, not pending ones, and deletes rows after 30 days', async () => {
    const day = 24 * 3600_000;
    const at = (days: number) => new Date(Date.now() - days * day);
    const make = (
      id: string,
      status: 'PROCESSED' | 'IGNORED' | 'FAILED' | 'PENDING',
      days: number,
    ) =>
      prisma.githubDelivery.create({
        data: { id, event: 'push', status, payload: { a: 1 }, receivedAt: at(days) },
      });
    await make('old-done', 'PROCESSED', 8);
    await make('old-ignored', 'IGNORED', 8);
    await make('old-failed', 'FAILED', 8);
    await make('old-pending', 'PENDING', 8);
    await make('new-failed', 'FAILED', 1);
    await make('new-done', 'PROCESSED', 1);
    await make('ancient', 'PROCESSED', 31);
    await cleanupDeliveries();
    expect((await row('old-done'))?.payload).toBeNull();
    expect((await row('old-ignored'))?.payload).toBeNull();
    expect((await row('old-failed'))?.payload).toBeNull();
    expect((await row('old-pending'))?.payload).toEqual({ a: 1 });
    expect((await row('new-done'))?.payload).toEqual({ a: 1 });
    expect((await row('new-failed'))?.payload).toEqual({ a: 1 });
    expect(await row('ancient')).toBeNull();
  });
});

describe('installation events', () => {
  const installation = (extra: object = {}) => ({
    id: 5001,
    account: { login: 'acme-labs', type: 'Organization' },
    suspended_at: null,
    ...extra,
  });
  const done = (id: string) =>
    vi.waitFor(async () => expect(['PROCESSED', 'IGNORED']).toContain((await row(id))?.status));

  it('creates the installation on created', async () => {
    await postWebhook(
      'installation',
      { action: 'created', installation: installation() },
      { deliveryId: 'i-1' },
    );
    await done('i-1');
    expect(await prisma.githubInstallation.findUnique({ where: { id: 5001 } })).toMatchObject({
      accountLogin: 'acme-labs',
      accountType: 'Organization',
      suspendedAt: null,
    });
  });

  it('marks the installation gone on deleted, as the sync does for one GitHub no longer lists', async () => {
    await prisma.githubInstallation.create({
      data: { id: 5001, accountLogin: 'acme-labs', accountType: 'Organization' },
    });
    await postWebhook(
      'installation',
      { action: 'deleted', installation: installation() },
      { deliveryId: 'i-2' },
    );
    await done('i-2');
    const stored = await prisma.githubInstallation.findUnique({ where: { id: 5001 } });
    expect(stored?.removedAt).not.toBeNull();
    // Removal is not a suspension
    expect(stored?.suspendedAt).toBeNull();
  });

  it('clears the removal when the installation is created again or unsuspended', async () => {
    await prisma.githubInstallation.upsert({
      where: { id: 5001 },
      create: {
        id: 5001,
        accountLogin: 'acme-labs',
        accountType: 'Organization',
        removedAt: new Date(),
      },
      update: { removedAt: new Date() },
    });
    await postWebhook(
      'installation',
      { action: 'unsuspend', installation: installation() },
      { deliveryId: 'i-2b' },
    );
    await done('i-2b');
    expect(
      (await prisma.githubInstallation.findUnique({ where: { id: 5001 } }))?.removedAt,
    ).toBeNull();
  });

  it('suspends and unsuspends', async () => {
    await postWebhook(
      'installation',
      { action: 'suspend', installation: installation({ suspended_at: '2026-11-06T09:00:00Z' }) },
      { deliveryId: 'i-3' },
    );
    await done('i-3');
    expect(
      (
        await prisma.githubInstallation.findUnique({ where: { id: 5001 } })
      )?.suspendedAt?.toISOString(),
    ).toBe('2026-11-06T09:00:00.000Z');
    await postWebhook(
      'installation',
      { action: 'unsuspend', installation: installation() },
      { deliveryId: 'i-4' },
    );
    await done('i-4');
    expect(
      (await prisma.githubInstallation.findUnique({ where: { id: 5001 } }))?.suspendedAt,
    ).toBeNull();
  });

  it('keeps the installation current on installation_repositories', async () => {
    await postWebhook(
      'installation_repositories',
      {
        action: 'added',
        installation: installation({ account: { login: 'renamed-labs', type: 'Organization' } }),
      },
      { deliveryId: 'i-5' },
    );
    await done('i-5');
    expect(
      (await prisma.githubInstallation.findUnique({ where: { id: 5001 } }))?.accountLogin,
    ).toBe('renamed-labs');
  });

  /**
   * A stored delivery of an installation event, as it would have been received at `at`
   * @param id
   * @param at
   * @param action
   * @param extra
   */
  const stored = (id: string, at: Date, action: string, extra: object = {}) =>
    prisma.githubDelivery.create({
      data: {
        id,
        event: 'installation',
        action,
        payload: { action, installation: installation(extra) },
        receivedAt: at,
      },
    });
  const T = Date.parse('2026-11-06T09:00:00Z');
  const lastEvent = async () =>
    (await prisma.githubInstallation.findUnique({ where: { id: 5001 } }))!;

  it('keeps the newer state when the older delivery is processed last', async () => {
    await stored('o-new', new Date(T + 20), 'unsuspend');
    await stored('o-old', new Date(T), 'suspend', { suspended_at: '2026-11-06T08:59:00Z' });
    await processDelivery('o-new');
    await processDelivery('o-old');
    expect((await lastEvent()).suspendedAt).toBeNull();
    expect((await row('o-old'))?.status).toBe('IGNORED');
    expect((await lastEvent()).lastEventAt?.getTime()).toBe(T + 20);
  });

  it('applies an event with the same timestamp as the last one', async () => {
    await stored('e-1', new Date(T), 'created');
    await stored('e-2', new Date(T), 'suspend', { suspended_at: '2026-11-06T08:59:00Z' });
    await processDelivery('e-1');
    await processDelivery('e-2');
    expect((await lastEvent()).suspendedAt).not.toBeNull();
    expect((await row('e-2'))?.status).toBe('PROCESSED');
  });

  it('applies created and the installation_repositories right after it, a few ms apart', async () => {
    await stored('c-1', new Date(T), 'created');
    await prisma.githubDelivery.create({
      data: {
        id: 'c-2',
        event: 'installation_repositories',
        action: 'added',
        payload: {
          action: 'added',
          installation: installation({ account: { login: 'renamed-labs', type: 'Organization' } }),
        },
        receivedAt: new Date(T + 5),
      },
    });
    await processDelivery('c-1');
    await processDelivery('c-2');
    expect((await row('c-1'))?.status).toBe('PROCESSED');
    expect((await row('c-2'))?.status).toBe('PROCESSED');
    expect((await lastEvent()).accountLogin).toBe('renamed-labs');
  });

  it('applies an event to a row the sync wrote before it, and not one the sync wrote after it', async () => {
    await prisma.githubInstallation.create({
      data: {
        id: 5001,
        accountLogin: 'acme-labs',
        accountType: 'Organization',
        lastEventAt: new Date(T + 1000),
      },
    });
    await stored('s-old', new Date(T), 'suspend', { suspended_at: '2026-11-06T08:59:00Z' });
    await processDelivery('s-old');
    expect((await row('s-old'))?.status).toBe('IGNORED');
    expect((await lastEvent()).suspendedAt).toBeNull();
  });

  it('applies a newer event even when an older one created the row after the first attempt', async () => {
    await stored('r-old', new Date(T), 'created');
    await stored('r-new', new Date(T + 5), 'suspend', { suspended_at: '2026-11-06T08:59:00Z' });
    await processDelivery('r-old');
    // The newer event's first conditional update ran before that row existed
    const update = vi
      .spyOn(prisma.githubInstallation, 'updateMany')
      .mockResolvedValueOnce({ count: 0 });
    try {
      await processDelivery('r-new');
    } finally {
      update.mockRestore();
    }
    expect((await row('r-new'))?.status).toBe('PROCESSED');
    expect((await lastEvent()).suspendedAt).not.toBeNull();
  });

  it('ignores an installation event without an installation', async () => {
    await postWebhook('installation', { action: 'created' }, { deliveryId: 'i-6' });
    await done('i-6');
    expect((await row('i-6'))?.status).toBe('IGNORED');
  });
});

/**
 * Sends unsigned deliveries in parallel batches, so a thousand take seconds, not a minute.
 * @param count How many to send
 * @returns Their statuses
 */
async function flood(count: number): Promise<number[]> {
  const statuses: number[] = [];
  const server = await listenForRawRequests(app);
  for (let sent = 0; sent < count; sent += 50) {
    const batch = Array.from({ length: Math.min(50, count - sent) }, () =>
      request(server).post(URL).set('X-GitHub-Event', 'push').send('{}'),
    );
    statuses.push(...(await Promise.all(batch)).map((r) => r.status));
  }
  server.close();
  return statuses;
}

describe('rate limit', () => {
  const clients = ['::ffff:127.0.0.1', '127.0.0.1', '::1'];
  const reset = async () => {
    for (const key of clients) {
      await githubWebhookLimiter.resetKey(key);
      await globalLimiter.resetKey(key);
    }
  };
  beforeEach(async () => {
    rateLimitTesting.enforce = true;
    await reset();
  });
  afterEach(async () => {
    await reset();
    rateLimitTesting.enforce = false;
  });

  it('answers 429 to the 1001st request in a minute without counting other /api paths against it', async () => {
    const get = () => request(app).get('/api/health');
    // Other /api traffic from the same address does not use up the webhook's allowance
    for (let i = 0; i < 5; i++) expect((await get()).status).not.toBe(429);
    expect((await flood(1000)).filter((status) => status === 429)).toHaveLength(0);
    expect(await flood(1)).toEqual([429]);
    // The webhook traffic is not counted against the global limit either
    expect((await get()).status).not.toBe(429);
  }, 60_000);

  it('does not count webhook requests against the global limit of 300', async () => {
    await flood(320);
    expect((await request(app).get('/api/health')).status).not.toBe(429);
  }, 60_000);
});

describe('a forgotten App', () => {
  const installationDelivery = (id: string, extra: object = {}) =>
    prisma.githubDelivery.create({
      data: {
        id,
        event: 'installation',
        action: 'created',
        installationId: 7001,
        payload: {
          action: 'created',
          installation: { id: 7001, account: { login: 'acme-labs', type: 'Organization' } },
        },
        ...extra,
      },
    });

  afterEach(async () => {
    // The tests below forget the App: the other tests of this file need one
    secret = (await seedGithubApp()).webhookSecret;
  });

  it('ignores the open deliveries, and a new App does not bring their installations back', async () => {
    await installationDelivery('f-pending', { status: 'PENDING' });
    await installationDelivery('f-failed', {
      status: 'FAILED',
      attempts: 1,
      nextAttemptAt: new Date(Date.now() - 1000),
      error: 'boom',
    });
    await installationDelivery('f-done', { status: 'PROCESSED', processedAt: new Date() });
    await deleteApp();
    for (const id of ['f-pending', 'f-failed']) {
      expect(await row(id)).toMatchObject({
        status: 'IGNORED',
        error: 'App forgotten',
        nextAttemptAt: null,
      });
    }
    expect((await row('f-done'))?.status).toBe('PROCESSED');

    await seedGithubApp();
    await retryDueDeliveries();
    expect(await prisma.githubInstallation.count()).toBe(0);
  });

  it('ignores a delivery when no App exists', async () => {
    await installationDelivery('f-none');
    await prisma.githubApp.deleteMany();
    await processDelivery('f-none');
    expect(await row('f-none')).toMatchObject({ status: 'IGNORED', error: 'App forgotten' });
    expect(await prisma.githubInstallation.count()).toBe(0);
  });

  it('ignores a delivery that was received before the current App was made', async () => {
    await prisma.githubApp.updateMany({ data: { createdAt: new Date() } });
    await installationDelivery('f-old', { receivedAt: new Date(Date.now() - 3_600_000) });
    await processDelivery('f-old');
    expect(await row('f-old')).toMatchObject({ status: 'IGNORED', error: 'App forgotten' });
    expect(await prisma.githubInstallation.count()).toBe(0);
  });
});
