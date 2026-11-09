/**
 * Send the events queued for bots. Each bot's queue goes strictly by `seq`: only its oldest
 * PENDING event is sent, and only once it is due, its webhook is ACTIVE and the bot is ACTIVE.
 * Redirects are not followed, the response body is never read, and every attempt is signed afresh
 * with the current secret.
 */
import http from 'http';
import https from 'https';

import { createId } from '@paralleldrive/cuid2';
import { Prisma, type BotEvent, type BotWebhook } from '@prisma/client';

import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { logger } from '../../utils/logger';
import { publicLookup, type PublicRequestDeps } from '../automation/webhook';
import { isAssignableBot } from '../issues/issue-references';
import { createNotification } from '../notifications/notifications.service';
import { SERVICE_ACCOUNT_NOTICE } from '../service-accounts/bot-guards';
import { ownersOf } from '../service-accounts/service-accounts.service';

import { signatureHeader } from './sign';
import { readBotWebhookSecret, type DeliveryView } from './webhook-config.service';
import { assertWebhookUrl } from './webhook-url';

/** Minutes to wait after each failed attempt; the attempt after the last one is final */
export const RETRY_DELAYS_MINUTES = [1, 5, 30, 120] as const;
/** FAILED deliveries in a row that pause a webhook */
export const PAUSE_AFTER_FAILURES = 10;
/** How long one attempt may take, connecting and answering */
export const SEND_TIMEOUT_MS = 10_000;
/** How long a claimed event stays out of other ticks' reach: an attempt plus a margin */
export const LEASE_MS = SEND_TIMEOUT_MS + 60_000;

/** Bots sent to at once */
const PARALLEL_BOTS = 5;
/** Bots one tick looks at, the longest waiting first */
const MAX_BOTS_PER_TICK = 20;
/** Events one bot gets in one tick, while each succeeds */
const MAX_EVENTS_PER_BOT = 5;
/** After this long a tick starts no new attempt */
const TICK_BUDGET_MS = 60_000;

const USER_AGENT = 'Axiom-Webhooks/1';
const LAST_ERROR_MAX = 200;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** What sending uses; tests replace the network and the clock. */
export interface SendDeps {
  open: PublicRequestDeps['open'];
  now: () => Date;
}

type SendResult = { ok: boolean; statusCode: number | null; error: string | null };

class SendTimeout extends Error {}

/**
 * Connect without following redirects. HTTPS goes through publicLookup, so the address checked is
 * the address connected to; plain HTTP only reaches here for the development localhost exception
 * that assertWebhookUrl allows.
 * @param url - The URL
 * @param request - The request
 */
export const openDirect: PublicRequestDeps['open'] = (url, request) =>
  new Promise((resolve, reject) => {
    const { method, headers, body, signal } = request;
    const req =
      url.protocol === 'http:'
        ? http.request(url, { method, headers, signal, agent: false }, resolve)
        : https.request(
            url,
            { method, headers, signal, lookup: publicLookup, agent: false },
            resolve,
          );
    req.on('error', reject).end(body);
  });

/**
 * The short, fixed reason an attempt failed. Never the response body, a header or the secret.
 * @param err - What was thrown
 */
function reasonOf(err: unknown): string {
  if (err instanceof SendTimeout) return 'timeout';
  if (err instanceof AppError) {
    if (err.message.includes('private/internal')) return 'address blocked';
    if (err.message.includes('does not resolve')) return 'host not found';
    return 'URL refused';
  }
  const e = err as NodeJS.ErrnoException;
  if (e?.code === 'ERR_BLOCKED_ADDRESS') return 'address blocked';
  if (e?.name === 'AbortError' || e?.code === 'ABORT_ERR') return 'timeout';
  if (e?.code === 'ENOTFOUND' || e?.code === 'EAI_AGAIN') return 'host not found';
  return 'connection failed';
}

/**
 * Send one event to a webhook, once. Writes nothing: the caller records the outcome.
 * @param event - The event: its id, type and payload
 * @param webhook - The webhook: its URL and sealed secret
 * @param deps - Replaceable dependencies (tests)
 */
export async function sendOne(
  event: Pick<BotEvent, 'id' | 'type' | 'payload'>,
  webhook: Pick<BotWebhook, 'id' | 'url' | 'secret'>,
  deps: Partial<SendDeps> = {},
): Promise<SendResult> {
  const open = deps.open ?? openDirect;
  const now = (deps.now ?? (() => new Date()))();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new SendTimeout());
    }, SEND_TIMEOUT_MS);
  });
  const attempt = (async () => {
    const body = JSON.stringify(event.payload);
    const signature = signatureHeader(
      readBotWebhookSecret(webhook),
      body,
      Math.floor(now.getTime() / 1000),
    );
    await assertWebhookUrl(webhook.url);
    return open(new URL(webhook.url), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': String(Buffer.byteLength(body)),
        'User-Agent': USER_AGENT,
        'Axiom-Event-Id': event.id,
        'Axiom-Event-Type': event.type,
        'Axiom-Signature': signature,
      },
      body,
      signal: controller.signal,
    });
  })();
  try {
    const res = await Promise.race([attempt, timedOut]);
    const status = res.statusCode ?? 0;
    res.destroy();
    if (status >= 200 && status < 300) return { ok: true, statusCode: status, error: null };
    const error = REDIRECT_STATUSES.has(status) ? 'redirect not followed' : `HTTP ${status}`;
    return { ok: false, statusCode: status || null, error: error.slice(0, LAST_ERROR_MAX) };
  } catch (err) {
    // An answer that comes after the timeout is closed unread
    attempt.then(
      (late) => late.destroy(),
      () => {},
    );
    return { ok: false, statusCode: null, error: reasonOf(err) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Tell each owner of a bot that its webhook was paused, with a link to the bot's page. Best
 * effort: the pause stands either way.
 * @param botId - The bot's user id
 */
async function notifyPaused(botId: string): Promise<void> {
  try {
    const bot = await prisma.serviceAccount.findUnique({
      where: { userId: botId },
      select: { user: { select: { displayName: true } }, org: { select: { slug: true } } },
    });
    if (!bot) return;
    for (const ownerId of await ownersOf(botId)) {
      await createNotification(
        ownerId,
        SERVICE_ACCOUNT_NOTICE,
        `The webhook of ${bot.user.displayName} was paused`,
        `${PAUSE_AFTER_FAILURES} deliveries in a row failed. Fix the endpoint, then resume it`,
        `/${bot.org.slug}/settings/service-accounts/${botId}`,
      );
    }
  } catch (err) {
    logger.error('telling about a paused bot webhook failed', { botId }, err as Error);
  }
}

/**
 * Count a FAILED delivery against the webhook; the one that makes it PAUSE_AFTER_FAILURES pauses
 * it and tells the owners, once.
 * @param botId - The bot's user id
 * @param now - The time of the failure
 */
async function countFailure(botId: string, now: Date): Promise<void> {
  const counted = await prisma.botWebhook.updateMany({
    where: { botId },
    data: { consecutiveFailures: { increment: 1 } },
  });
  if (counted.count === 0) return;
  const paused = await prisma.botWebhook.updateMany({
    where: { botId, status: 'ACTIVE', consecutiveFailures: { gte: PAUSE_AFTER_FAILURES } },
    data: { status: 'PAUSED', pausedAt: now },
  });
  if (paused.count > 0) await notifyPaused(botId);
}

/**
 * Store the outcome of one attempt on a queued event.
 * @param event - The event as it was before the attempt
 * @param result - The outcome
 * @param now - The time of the attempt
 */
async function record(event: BotEvent, result: SendResult, now: Date): Promise<void> {
  const attempts = event.attempts + 1;
  const common = {
    attempts,
    lastAttemptAt: now,
    lastStatusCode: result.statusCode,
    lastError: result.error,
  };
  if (result.ok) {
    const done = await prisma.botEvent.updateMany({
      where: { id: event.id, status: 'PENDING' },
      data: { ...common, status: 'DELIVERED', deliveredAt: now },
    });
    if (done.count > 0) {
      await prisma.botWebhook.updateMany({
        where: { botId: event.botId, consecutiveFailures: { gt: 0 } },
        data: { consecutiveFailures: 0 },
      });
    }
    return;
  }
  const delay = RETRY_DELAYS_MINUTES[attempts - 1];
  if (delay !== undefined) {
    await prisma.botEvent.updateMany({
      where: { id: event.id, status: 'PENDING' },
      data: { ...common, nextAttemptAt: new Date(now.getTime() + delay * 60_000) },
    });
    return;
  }
  const failed = await prisma.botEvent.updateMany({
    where: { id: event.id, status: 'PENDING' },
    data: { ...common, status: 'FAILED' },
  });
  if (failed.count > 0) await countFailure(event.botId, now);
}

/**
 * Whether the bot may still hear this event: an issue event needs the bot to be an assignable
 * member of the issue's team now, anything else an ACTIVE bot.
 * @param event - The event
 */
async function stillWanted(event: BotEvent): Promise<boolean> {
  const projectId = (event.payload as { project?: { id?: unknown } } | null)?.project?.id;
  if (typeof projectId === 'string') return isAssignableBot(event.botId, projectId);
  const account = await prisma.serviceAccount.findUnique({
    where: { userId: event.botId },
    select: { status: true },
  });
  return account?.status === 'ACTIVE';
}

type Tally = { sent: number; failed: number; dropped: number };

/**
 * Lease a bot's head event for one attempt. The event stays PENDING, so the bot's queue keeps its
 * order, and its due time moves past the attempt, so no other tick sends it meanwhile. A crash
 * mid-send retries it once the lease runs out.
 * @param head - The event, as read
 * @param now - The time of the attempt
 * @returns Whether this tick holds it: still PENDING, due, and the bot's lowest PENDING seq
 */
async function claim(head: BotEvent, now: Date): Promise<boolean> {
  const until = new Date(now.getTime() + LEASE_MS);
  const count = await prisma.$executeRaw`
    UPDATE bot_events e SET "nextAttemptAt" = ${until}
    WHERE e.id = ${head.id}
      AND e.status = 'PENDING'
      AND e."nextAttemptAt" <= ${now}
      AND NOT EXISTS (
        SELECT 1 FROM bot_events o
        WHERE o."botId" = e."botId" AND o.status = 'PENDING' AND o.seq < e.seq
      )`;
  return count === 1;
}

let stopping = false;

/**
 * Tell the sender the worker is stopping: a send in flight finishes and is recorded, and no
 * other starts. Tests switch it back off.
 * @param stop - Whether the worker is stopping
 */
export function stopBotDeliveries(stop = true): void {
  stopping = stop;
}

/**
 * Send a bot's due events in seq order, until one fails, none is due, or the tick runs out.
 * @param botId - The bot's user id
 * @param deps - Replaceable dependencies (tests)
 * @param tally - Counts to add to
 * @param deadline - When the tick stops starting attempts (wall clock)
 */
async function drainBot(
  botId: string,
  deps: Partial<SendDeps>,
  tally: Tally,
  deadline: number,
): Promise<void> {
  const clock = deps.now ?? (() => new Date());
  for (let i = 0; i < MAX_EVENTS_PER_BOT && Date.now() < deadline && !stopping; i++) {
    const now = clock();
    const head = await prisma.botEvent.findFirst({
      where: { botId, status: 'PENDING' },
      orderBy: { seq: 'asc' },
    });
    if (!head || head.nextAttemptAt > now) return;
    const webhook = await prisma.botWebhook.findUnique({ where: { botId } });
    if (!webhook || webhook.status !== 'ACTIVE') return;
    if (!(await stillWanted(head))) {
      const dropped = await prisma.botEvent.updateMany({
        where: { id: head.id, status: 'PENDING' },
        data: { status: 'DROPPED', lastError: 'bot not on the team' },
      });
      tally.dropped += dropped.count;
      continue;
    }
    if (stopping || !(await claim(head, now))) return;
    const result = await sendOne(head, webhook, deps);
    await record(head, result, now);
    if (!result.ok) {
      tally.failed++;
      return;
    }
    tally.sent++;
  }
}

/**
 * One round of the queue: drop what suspended bots still have pending, then send each due bot's
 * events, up to PARALLEL_BOTS bots at once.
 * @param deps - Replaceable dependencies (tests); `botIds` limits the round to these bots
 * @returns How many events were sent, failed an attempt, or were dropped
 */
export async function deliverDueEvents(
  deps: Partial<SendDeps> & { botIds?: string[] } = {},
): Promise<Tally> {
  const { botIds, ...sendDeps } = deps;
  const now = (deps.now ?? (() => new Date()))();
  const deadline = Date.now() + TICK_BUDGET_MS;
  const tally: Tally = { sent: 0, failed: 0, dropped: 0 };

  const dropped = await prisma.botEvent.updateMany({
    where: {
      status: 'PENDING',
      bot: { status: { not: 'ACTIVE' } },
      ...(botIds ? { botId: { in: botIds } } : {}),
    },
    data: { status: 'DROPPED', lastError: 'bot suspended' },
  });
  tally.dropped += dropped.count;

  const only = botIds
    ? botIds.length > 0
      ? Prisma.sql`AND e."botId" IN (${Prisma.join(botIds)})`
      : Prisma.sql`AND FALSE`
    : Prisma.empty;
  const due = await prisma.$queryRaw<{ botId: string }[]>`
    SELECT h."botId" FROM (
      SELECT DISTINCT ON (e."botId") e."botId", e."nextAttemptAt"
      FROM bot_events e
      JOIN bot_webhooks w ON w."botId" = e."botId" AND w.status = 'ACTIVE'
      JOIN service_accounts s ON s."userId" = e."botId" AND s.status = 'ACTIVE'
      WHERE e.status = 'PENDING' ${only}
      ORDER BY e."botId", e.seq
    ) h
    WHERE h."nextAttemptAt" <= ${now}
    ORDER BY h."nextAttemptAt"
    LIMIT ${MAX_BOTS_PER_TICK}`;

  const waiting = due.map((d) => d.botId);
  const lane = async () => {
    for (let botId = waiting.shift(); botId; botId = waiting.shift()) {
      if (Date.now() >= deadline || stopping) return;
      try {
        await drainBot(botId, sendDeps, tally, deadline);
      } catch (err) {
        logger.error('sending bot events failed', { botId }, err as Error);
      }
    }
  };
  await Promise.all(Array.from({ length: PARALLEL_BOTS }, lane));
  return tally;
}

/**
 * Send a `ping` to a bot's webhook now, paused or not, and log it as a delivery. It never counts
 * toward the failure count or the pause.
 * @param botId - The bot's user id
 * @param deps - Replaceable dependencies (tests)
 * @throws {AppError} 404 when the bot has no webhook, 409 when the bot is suspended
 */
export async function sendTestEvent(
  botId: string,
  deps: Partial<SendDeps> = {},
): Promise<DeliveryView> {
  const webhook = await prisma.botWebhook.findUnique({ where: { botId } });
  if (!webhook) throw new AppError(404, 'This bot has no webhook');
  const account = await prisma.serviceAccount.findUnique({
    where: { userId: botId },
    select: { status: true },
  });
  if (account?.status !== 'ACTIVE') throw new AppError(409, 'A suspended bot gets no events');

  const now = (deps.now ?? (() => new Date()))();
  const id = createId();
  const payload = { id, type: 'ping', createdAt: now.toISOString(), bot: { id: botId } };
  const result = await sendOne({ id, type: 'ping', payload }, webhook, deps);
  const row = await prisma.botEvent.create({
    data: {
      id,
      botId,
      type: 'ping',
      payload: payload as Prisma.InputJsonObject,
      status: result.ok ? 'DELIVERED' : 'FAILED',
      attempts: 1,
      nextAttemptAt: now,
      lastAttemptAt: now,
      lastStatusCode: result.statusCode,
      lastError: result.error,
      deliveredAt: result.ok ? now : null,
      createdAt: now,
    },
  });
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    attempts: row.attempts,
    lastStatusCode: row.lastStatusCode,
    lastError: row.lastError,
    createdAt: row.createdAt,
    lastAttemptAt: row.lastAttemptAt,
    deliveredAt: row.deliveredAt,
    issueKey: null,
  };
}
