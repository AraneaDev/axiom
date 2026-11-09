import dns from 'dns/promises';
import type { IncomingMessage } from 'http';

import { createId } from '@paralleldrive/cuid2';
import type { Prisma } from '@prisma/client';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';

import { prisma } from '../../config/database';
import { MINTABLE_SCOPES } from '../../middleware/token-scopes';
import {
  addMemberToContext,
  cleanupTestContext,
  createTestContext,
  type TestContext,
  type TestUser,
} from '../../test/factory';
import { authPost } from '../../test/helpers';
import type { PublicRequest } from '../automation/webhook';
import { createServiceAccount } from '../service-accounts/service-accounts.service';
import * as usersService from '../users/users.service';

import {
  SHUTDOWN_WAIT_MS,
  cleanupBotEvents,
  startBotDeliveryTick,
  waitForBotDeliveryTick,
} from './deliveries.job';
import {
  PAUSE_AFTER_FAILURES,
  RETRY_DELAYS_MINUTES,
  SEND_TIMEOUT_MS,
  deliverDueEvents,
  sendTestEvent,
} from './sender';
import { verifySignature } from './sign';
import { readBotWebhookSecret, resumeBotWebhook, setBotWebhook } from './webhook-config.service';

// Literal public addresses: the check needs no DNS
const URL_A = 'https://93.184.216.34/hooks/a';
const URL_B = 'https://93.184.216.35/hooks/b';
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

type Call = { url: string; request: PublicRequest };

/**
 * A fake response: status and headers only, and a body that must never be read
 * @param statusCode - Its status
 * @param headers - Its headers
 */
function response(statusCode: number, headers: Record<string, string> = {}): IncomingMessage {
  return {
    statusCode,
    headers,
    destroy: vi.fn(),
    on: () => {
      throw new Error('the body was read');
    },
    read: () => {
      throw new Error('the body was read');
    },
  } as unknown as IncomingMessage;
}

describe('bot event sender', () => {
  let ctx: TestContext;
  let other: TestContext;
  let member: TestUser;
  let botA: string;
  let botB: string;
  const botIds: string[] = [];
  let clock: Date;
  let calls: Call[];
  let answer: (url: string) => Promise<IncomingMessage>;

  const open = async (url: URL, request: PublicRequest) => {
    calls.push({ url: url.href, request });
    return answer(url.href);
  };
  const run = () => deliverDueEvents({ open, now: () => clock, botIds });
  const later = (ms: number) => {
    clock = new Date(clock.getTime() + ms);
  };

  async function makeBot(username: string, url: string): Promise<string> {
    const bot = await createServiceAccount(ctx.orgId, ctx.owner.id, {
      username,
      displayName: `Bot ${username}`,
      ownerIds: [ctx.owner.id, member.id],
    });
    botIds.push(bot.id);
    await prisma.teamMembership.create({
      data: { teamId: ctx.teamId, userId: bot.id, role: 'MEMBER' },
    });
    await setBotWebhook(bot.id, url);
    return bot.id;
  }

  /**
   * Queue events for a bot, as the emitter writes them
   * @param botId - The bot
   * @param n - How many
   */
  async function queue(botId: string, n = 1): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const id = createId();
      const payload = {
        id,
        type: 'issue.edited',
        createdAt: clock.toISOString(),
        org: { id: ctx.orgId, slug: ctx.orgSlug },
        project: { id: ctx.projectId, key: ctx.projectPrefix },
        issue: { id: 'issue-x', key: `${ctx.projectPrefix}-1` },
        actor: { id: ctx.owner.id, kind: 'PERSON' },
        changes: { fields: ['title'] },
      };
      await prisma.botEvent.create({
        data: {
          id,
          botId,
          type: 'issue.edited',
          payload: payload as Prisma.InputJsonObject,
          nextAttemptAt: clock,
          createdAt: clock,
        },
      });
      ids.push(id);
    }
    return ids;
  }

  const event = (id: string) => prisma.botEvent.findUniqueOrThrow({ where: { id } });
  const hook = (botId: string) => prisma.botWebhook.findUniqueOrThrow({ where: { botId } });
  const eventIdOf = (call: Call) => call.request.headers?.['Axiom-Event-Id'];

  beforeAll(async () => {
    ctx = await createTestContext('botsend');
    other = await createTestContext('botsend2');
    member = await addMemberToContext(ctx, {
      email: 'voorbeeld-member@botsend.invalid',
      username: 'voorbeeld-member-botsend',
    });
    botA = await makeBot('acme-send-bot-a', URL_A);
    botB = await makeBot('acme-send-bot-b', URL_B);
  });

  beforeEach(async () => {
    clock = new Date('2026-11-09T12:00:00.000Z');
    calls = [];
    answer = async () => response(200);
    await prisma.botEvent.deleteMany({ where: { botId: { in: botIds } } });
    await prisma.notification.deleteMany({ where: { userId: { in: [ctx.owner.id, member.id] } } });
    await prisma.botWebhook.updateMany({
      where: { botId: { in: botIds } },
      data: { status: 'ACTIVE', consecutiveFailures: 0, pausedAt: null },
    });
    await prisma.botWebhook.update({ where: { botId: botA }, data: { url: URL_A } });
    await prisma.serviceAccount.updateMany({
      where: { userId: { in: botIds } },
      data: { status: 'ACTIVE', suspendedReason: null, suspendedAt: null },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  afterAll(async () => {
    await cleanupTestContext(ctx);
    await cleanupTestContext(other);
    await prisma.auditLog.deleteMany({ where: { userId: { in: botIds } } });
    await prisma.user.deleteMany({ where: { id: { in: [...botIds, member.id] } } });
  });

  it('a 200 marks DELIVERED, sends the four headers and resets the failure count', async () => {
    await prisma.botWebhook.update({ where: { botId: botA }, data: { consecutiveFailures: 3 } });
    const [id] = await queue(botA);
    const result = await run();
    expect(result).toEqual({ sent: 1, failed: 0, dropped: 0 });

    expect(calls).toHaveLength(1);
    const [{ url, request }] = calls;
    expect(url).toBe(URL_A);
    expect(request.method).toBe('POST');
    const row = await event(id);
    expect(request.body).toBe(JSON.stringify(row.payload));
    const headers = request.headers!;
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['Axiom-Event-Id']).toBe(id);
    expect(headers['Axiom-Event-Type']).toBe('issue.edited');
    expect(headers['User-Agent']).toBe('Axiom-Webhooks/1');
    const secret = readBotWebhookSecret(await hook(botA));
    const t = Math.floor(clock.getTime() / 1000);
    expect(headers['Axiom-Signature']).toMatch(new RegExp(`^t=${t},v1=[0-9a-f]{64}$`));
    expect(verifySignature(secret, request.body!, headers['Axiom-Signature'], t)).toBe(true);

    expect(row).toMatchObject({
      status: 'DELIVERED',
      attempts: 1,
      lastStatusCode: 200,
      lastError: null,
      lastAttemptAt: clock,
      deliveredAt: clock,
    });
    expect((await hook(botA)).consecutiveFailures).toBe(0);
  });

  it('a 500 schedules retries at 1, 5, 30 and 120 minutes, then FAILED on the 5th attempt', async () => {
    answer = async () => response(500);
    const [id] = await queue(botA);
    for (const [i, delay] of RETRY_DELAYS_MINUTES.entries()) {
      expect(await run()).toEqual({ sent: 0, failed: 1, dropped: 0 });
      const row = await event(id);
      expect(row).toMatchObject({
        status: 'PENDING',
        attempts: i + 1,
        lastStatusCode: 500,
        lastError: 'HTTP 500',
      });
      expect(row.nextAttemptAt.getTime()).toBe(clock.getTime() + delay * MINUTE);
      // Not due a moment before
      later(delay * MINUTE - 1000);
      await run();
      expect(calls).toHaveLength(i + 1);
      later(1000);
    }
    expect(await run()).toEqual({ sent: 0, failed: 1, dropped: 0 });
    const row = await event(id);
    expect(row).toMatchObject({ status: 'FAILED', attempts: 5, lastError: 'HTTP 500' });
    expect(calls).toHaveLength(5);
    expect((await hook(botA)).consecutiveFailures).toBe(1);
    later(DAY);
    await run();
    expect(calls).toHaveLength(5);
  });

  it('a 302 is a failure and the Location is not requested', async () => {
    answer = async () => response(302, { location: 'https://93.184.216.36/elsewhere' });
    const [id] = await queue(botA);
    expect(await run()).toEqual({ sent: 0, failed: 1, dropped: 0 });
    expect(calls.map((c) => c.url)).toEqual([URL_A]);
    expect(await event(id)).toMatchObject({
      status: 'PENDING',
      attempts: 1,
      lastStatusCode: 302,
      lastError: 'redirect not followed',
    });
  });

  it('a host resolving to 10.0.0.1 at send time fails with the blocked reason', async () => {
    await prisma.botWebhook.update({
      where: { botId: botA },
      data: { url: 'https://hooks.acme-labs.invalid/axiom' },
    });
    vi.spyOn(dns, 'resolve4').mockResolvedValue(['10.0.0.1'] as never);
    vi.spyOn(dns, 'resolve6').mockResolvedValue([] as never);
    const [first] = await queue(botA);
    expect(await run()).toEqual({ sent: 0, failed: 1, dropped: 0 });
    expect(calls).toHaveLength(0);
    expect(await event(first)).toMatchObject({
      attempts: 1,
      lastStatusCode: null,
      lastError: 'address blocked',
    });

    // Public when checked, private when connected to: the pinned lookup refuses it
    await prisma.botEvent.deleteMany({ where: { botId: botA } });
    vi.mocked(dns.resolve4).mockResolvedValue(['93.184.216.34'] as never);
    answer = async () => {
      const err: NodeJS.ErrnoException = new Error('hooks.acme-labs.invalid resolves to 10.0.0.1');
      err.code = 'ERR_BLOCKED_ADDRESS';
      throw err;
    };
    const [second] = await queue(botA);
    await run();
    expect(calls).toHaveLength(1);
    expect(await event(second)).toMatchObject({ attempts: 1, lastError: 'address blocked' });
  });

  it('the 10th FAILED delivery in a row pauses the webhook and notifies each owner once', async () => {
    answer = async () => response(503);
    await prisma.botWebhook.update({
      where: { botId: botA },
      data: { consecutiveFailures: PAUSE_AFTER_FAILURES - 1 },
    });
    const [id, next] = await queue(botA, 2);
    await prisma.botEvent.update({ where: { id }, data: { attempts: 4 } });
    await run();
    expect(await event(id)).toMatchObject({ status: 'FAILED', attempts: 5 });
    const row = await hook(botA);
    expect(row).toMatchObject({ status: 'PAUSED', consecutiveFailures: PAUSE_AFTER_FAILURES });
    expect(row.pausedAt).toEqual(clock);
    // Paused: the next event waits
    expect(calls).toHaveLength(1);
    expect(await event(next)).toMatchObject({ status: 'PENDING', attempts: 0 });

    later(DAY);
    await run();
    expect(calls).toHaveLength(1);
    for (const owner of [ctx.owner.id, member.id]) {
      const notes = await prisma.notification.findMany({ where: { userId: owner } });
      expect(notes).toHaveLength(1);
      expect(notes[0]).toMatchObject({
        type: 'service_account',
        link: `/${ctx.orgSlug}/settings/service-accounts/${botA}`,
      });
      expect(notes[0].title).toContain('Bot acme-send-bot-a');
    }
    expect(await prisma.notification.count({ where: { userId: botA } })).toBe(0);
  });

  it('a paused webhook sends nothing until resumed, then continues in seq order', async () => {
    await prisma.botWebhook.update({
      where: { botId: botA },
      data: { status: 'PAUSED', consecutiveFailures: 10, pausedAt: clock },
    });
    const ids = await queue(botA, 3);
    expect(await run()).toEqual({ sent: 0, failed: 0, dropped: 0 });
    expect(calls).toHaveLength(0);

    await resumeBotWebhook(botA);
    expect(await run()).toEqual({ sent: 3, failed: 0, dropped: 0 });
    expect(calls.map(eventIdOf)).toEqual(ids);
  });

  it('the second event waits while the first is in backoff', async () => {
    const [first, second] = await queue(botA, 2);
    answer = async () => response(500);
    await run();
    expect(calls.map(eventIdOf)).toEqual([first]);
    answer = async () => response(200);
    await run();
    expect(calls).toHaveLength(1);
    expect(await event(second)).toMatchObject({ status: 'PENDING', attempts: 0 });

    later(MINUTE);
    expect(await run()).toEqual({ sent: 2, failed: 0, dropped: 0 });
    expect(calls.map(eventIdOf)).toEqual([first, first, second]);
  });

  it("a hanging endpoint times out after SEND_TIMEOUT_MS and another bot's event is still delivered in the same tick", async () => {
    const [hung] = await queue(botA);
    const [fine] = await queue(botB);
    let signal: AbortSignal | undefined;
    let reached!: () => void;
    const hanging = new Promise<void>((resolve) => {
      reached = resolve;
    });
    answer = (url) => {
      if (url !== URL_A) return Promise.resolve(response(200));
      reached();
      // Never answers, and ignores the abort: the sender must give up on its own
      return new Promise<IncomingMessage>(() => {});
    };
    const realOpen = open;
    const tracked = async (url: URL, request: PublicRequest) => {
      if (url.href === URL_A) signal = request.signal;
      return realOpen(url, request);
    };

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const tick = deliverDueEvents({ open: tracked, now: () => clock, botIds });
    await hanging;
    await vi.advanceTimersByTimeAsync(SEND_TIMEOUT_MS - 1);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const result = await tick;
    vi.useRealTimers();

    expect(signal?.aborted).toBe(true);
    expect(result).toEqual({ sent: 1, failed: 1, dropped: 0 });
    expect(await event(hung)).toMatchObject({
      status: 'PENDING',
      attempts: 1,
      lastStatusCode: null,
      lastError: 'timeout',
    });
    expect(await event(fine)).toMatchObject({ status: 'DELIVERED', attempts: 1 });
  });

  it('two ticks at once send each event once, in seq order per bot', async () => {
    const a = await queue(botA, 3);
    const b = await queue(botB, 2);
    // A slow endpoint, so the two ticks overlap
    answer = () => new Promise((resolve) => setTimeout(() => resolve(response(200)), 30));
    const results = await Promise.all([run(), run()]);
    const sent = calls.map(eventIdOf);
    expect([...sent].sort()).toEqual([...a, ...b].sort());
    expect(results.reduce((n, r) => n + r.sent, 0)).toBe(5);
    expect(sent.filter((id) => a.includes(id!))).toEqual(a);
    expect(sent.filter((id) => b.includes(id!))).toEqual(b);
    for (const id of [...a, ...b]) {
      expect(await event(id)).toMatchObject({ status: 'DELIVERED', attempts: 1 });
    }
  });

  it('a claimed head is leased: a second tick within the lease does not send it', async () => {
    const [id] = await queue(botA);
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let reached!: () => void;
    const started = new Promise<void>((resolve) => {
      reached = resolve;
    });
    answer = async () => {
      reached();
      await held;
      return response(200);
    };
    const first = run();
    await started;
    const leased = await event(id);
    expect(leased.status).toBe('PENDING');
    expect(leased.nextAttemptAt.getTime()).toBe(clock.getTime() + SEND_TIMEOUT_MS + MINUTE);
    expect(await run()).toEqual({ sent: 0, failed: 0, dropped: 0 });
    release();
    expect(await first).toEqual({ sent: 1, failed: 0, dropped: 0 });
    expect(calls).toHaveLength(1);
  });

  describe('worker shutdown', () => {
    it('waits for the tick in flight, and a second tick does not start meanwhile', async () => {
      let finish!: () => void;
      let done = false;
      const tick = startBotDeliveryTick(
        () =>
          new Promise<void>((resolve) => {
            finish = () => {
              done = true;
              resolve();
            };
          }),
      );
      expect(tick).not.toBeNull();
      expect(startBotDeliveryTick(async () => {})).toBeNull();
      const waited = waitForBotDeliveryTick();
      setTimeout(() => finish(), 20);
      expect(await waited).toBe(true);
      expect(done).toBe(true);
      expect(await waitForBotDeliveryTick()).toBe(true);
    });

    it('gives up on a hanging tick after SHUTDOWN_WAIT_MS', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      let finish!: () => void;
      startBotDeliveryTick(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      );
      let result: boolean | undefined;
      const waited = waitForBotDeliveryTick().then((r) => {
        result = r;
      });
      await vi.advanceTimersByTimeAsync(SHUTDOWN_WAIT_MS - 1);
      expect(result).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1);
      await waited;
      expect(result).toBe(false);
      vi.useRealTimers();
      finish();
      await waitForBotDeliveryTick();
    });
  });

  it("a suspended bot's pending events become DROPPED", async () => {
    await prisma.serviceAccount.update({
      where: { userId: botA },
      data: { status: 'SUSPENDED', suspendedReason: 'MANUAL', suspendedAt: clock },
    });
    const ids = await queue(botA, 2);
    const [other] = await queue(botB);
    expect(await run()).toEqual({ sent: 1, failed: 0, dropped: 2 });
    expect(calls.map(eventIdOf)).toEqual([other]);
    for (const id of ids) {
      expect(await event(id)).toMatchObject({ status: 'DROPPED', attempts: 0 });
    }
  });

  it("a bot no longer on the issue's team gets its event DROPPED at send time", async () => {
    const [id] = await queue(botA);
    await prisma.teamMembership.updateMany({
      where: { teamId: ctx.teamId, userId: botA },
      data: { role: 'VIEWER' },
    });
    try {
      expect(await run()).toEqual({ sent: 0, failed: 0, dropped: 1 });
      expect(calls).toHaveLength(0);
      expect(await event(id)).toMatchObject({ status: 'DROPPED', attempts: 0 });
    } finally {
      await prisma.teamMembership.updateMany({
        where: { teamId: ctx.teamId, userId: botA },
        data: { role: 'MEMBER' },
      });
    }
  });

  it('test send works while paused and leaves the count and the pause alone', async () => {
    await prisma.botWebhook.update({
      where: { botId: botA },
      data: { status: 'PAUSED', consecutiveFailures: 10, pausedAt: clock },
    });
    const view = await sendTestEvent(botA, { open, now: () => clock });
    expect(view).toMatchObject({
      type: 'ping',
      status: 'DELIVERED',
      attempts: 1,
      lastStatusCode: 200,
      lastError: null,
      issueKey: null,
    });
    expect(calls).toHaveLength(1);
    const body = JSON.parse(calls[0].request.body!);
    expect(body).toEqual({
      id: view.id,
      type: 'ping',
      createdAt: clock.toISOString(),
      bot: { id: botA },
    });
    expect(calls[0].request.headers?.['Axiom-Event-Type']).toBe('ping');
    const row = await event(view.id);
    expect(row).toMatchObject({ type: 'ping', status: 'DELIVERED', botId: botA });

    answer = async () => response(500);
    const failed = await sendTestEvent(botA, { open, now: () => clock });
    expect(failed).toMatchObject({ status: 'FAILED', lastStatusCode: 500, lastError: 'HTTP 500' });

    expect(await hook(botA)).toMatchObject({ status: 'PAUSED', consecutiveFailures: 10 });
    // A logged ping is never sent again by the queue
    await resumeBotWebhook(botA);
    calls = [];
    await run();
    expect(calls).toHaveLength(0);
  });

  it('a token is refused UI_ONLY', async () => {
    const path = `/api/service-accounts/${botA}/webhook/test`;
    const { token } = await usersService.createApiToken(ctx.owner.id, {
      name: 'hook-test-probe',
      scopes: [...MINTABLE_SCOPES],
    });
    const request = (await import('supertest')).default;
    const app = (await import('../../index')).default;
    const res = await request(app)
      .post(path)
      .set('Authorization', `Token ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('UI_ONLY');
    // Someone outside the bot's owners and org admins does not see it
    expect((await authPost(path, other.owner.token, {})).status).toBe(404);
    expect(await prisma.botEvent.count({ where: { botId: botA } })).toBe(0);
  });

  it('cleanup deletes finished rows older than 30 days and keeps PENDING', async () => {
    const now = new Date('2026-12-31T00:00:00.000Z');
    const old = new Date(now.getTime() - 31 * DAY);
    const recent = new Date(now.getTime() - 29 * DAY);
    const rows = [
      { status: 'DELIVERED', createdAt: old },
      { status: 'FAILED', createdAt: old },
      { status: 'DROPPED', createdAt: old },
      { status: 'PENDING', createdAt: old },
      { status: 'DELIVERED', createdAt: recent },
    ] as const;
    const ids: string[] = [];
    for (const r of rows) {
      const id = createId();
      ids.push(id);
      await prisma.botEvent.create({
        data: {
          id,
          botId: botA,
          type: 'ping',
          payload: {},
          status: r.status,
          createdAt: r.createdAt,
        },
      });
    }
    expect(await cleanupBotEvents(now)).toBeGreaterThanOrEqual(3);
    const left = await prisma.botEvent.findMany({ where: { id: { in: ids } } });
    expect(left.map((e) => e.id).sort()).toEqual([ids[3], ids[4]].sort());
  });
});
