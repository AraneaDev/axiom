import { createHmac, timingSafeEqual } from 'node:crypto';

import { Prisma } from '@prisma/client';

import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { logger } from '../../utils/logger';

import { getGithubAppSecrets } from './github-app.service';
import { handlersFor, type GithubDeliveryContext } from './webhook-dispatch';

const MAX_ATTEMPTS = 5;
/** Minutes to wait after the first, second, third and fourth failed attempt */
const BACKOFF_MINUTES = [1, 5, 15, 60] as const;
/** A claimed delivery is not claimed again for this long: a worker that died is retried after it */
const LEASE_MS = 5 * 60_000;
/** A stored delivery whose first run never started (the process died) is picked up after this */
const FIRST_RUN_GRACE_MS = 60_000;
const ERROR_MAX = 500;
const PAYLOAD_DAYS = 7;
const ROW_DAYS = 30;
const DAY_MS = 24 * 3600_000;
const DELIVERY_ID_PATTERN = /^[A-Za-z0-9._:-]{1,100}$/;
const EVENT_PATTERN = /^[a-z0-9_]{1,60}$/;

// ---- Receiving

/**
 * Whether the signature header is the HMAC-SHA256 of exactly these bytes under the secret.
 * @param raw The body as it arrived
 * @param header The `X-Hub-Signature-256` header
 * @param secret The App's webhook secret
 */
function validSignature(raw: Buffer, header: string | undefined, secret: string): boolean {
  if (typeof header !== 'string' || !/^sha256=[0-9a-f]{64}$/.test(header)) return false;
  const expected = createHmac('sha256', secret).update(raw).digest();
  return timingSafeEqual(expected, Buffer.from(header.slice('sha256='.length), 'hex'));
}

/**
 * The JSON text made storable: each escaped NUL (`\u0000`) and each unpaired surrogate escape
 * (a high one not followed by a low one, or a low one on its own) is replaced by U+FFFD, since
 * Postgres jsonb refuses both. A valid pair is kept. Done after the signature was checked. An
 * escaped backslash followed by "u0000" is text, not an escape, and is kept as is.
 * @param text The body
 */
const storableJson = (text: string): string =>
  text.replace(
    /\\(?:\\|(u[dD][89abAB][0-9a-fA-F]{2}\\u[dD][c-fC-F][0-9a-fA-F]{2})|u([0-9a-fA-F]{4}))/g,
    (match, pair: string | undefined, single: string | undefined) => {
      if (pair || single === undefined) return match;
      const code = parseInt(single, 16);
      return code === 0 || (code >= 0xd800 && code <= 0xdfff) ? '\uFFFD' : match;
    },
  );

/**
 * The SQLSTATE of a database error, wherever the driver adapter puts it.
 * @param err What the insert threw
 */
function sqlState(err: unknown): string | undefined {
  let at: unknown = err;
  for (let depth = 0; depth < 4 && typeof at === 'object' && at !== null; depth++) {
    const fields = at as {
      originalCode?: unknown;
      code?: unknown;
      cause?: unknown;
      meta?: unknown;
    };
    for (const value of [fields.originalCode, fields.code]) {
      if (typeof value === 'string' && /^[0-9A-Z]{5}$/.test(value)) return value;
    }
    const meta = fields.meta as { driverAdapterError?: unknown } | undefined;
    at = fields.cause ?? meta?.driverAdapterError;
  }
  return undefined;
}

/** Postgres refused the text of a JSON value: invalid text representation, untranslatable escape */
const JSON_TEXT_REFUSALS = new Set(['22P02', '22P05']);

const idOf = (value: unknown): number | null => {
  const id = (value as { id?: unknown } | null | undefined)?.id;
  return typeof id === 'number' && Number.isSafeInteger(id) ? id : null;
};

/** What `receive` reports: the caller answers GitHub with it */
export type ReceiveResult = { duplicate: true } | { accepted: true };

/**
 * Checks a delivery and stores it. The signature is the credential: it is checked against the
 * raw bytes before anything is parsed, and nothing is stored or logged for a delivery that fails
 * it. Processing starts after this returns (`setImmediate`), so GitHub is answered quickly.
 * @param raw The body, exactly as it arrived
 * @param headers The delivery's headers
 * @param headers.signature `X-Hub-Signature-256`
 * @param headers.deliveryId `X-GitHub-Delivery`
 * @param headers.event `X-GitHub-Event`
 * @throws {AppError} 404 with no App, 401 on a bad signature, 400 on a body or headers unusable
 */
export async function receive(
  raw: Buffer,
  headers: { signature?: string; deliveryId?: string; event?: string },
): Promise<ReceiveResult> {
  const app = await getGithubAppSecrets();
  if (!app) throw new AppError(404, 'No GitHub App is set up', 'NOT_FOUND');
  if (!validSignature(raw, headers.signature, app.webhookSecret)) {
    throw new AppError(401, 'The signature does not match', 'INVALID_SIGNATURE');
  }
  const { deliveryId, event } = headers;
  if (
    !deliveryId ||
    !DELIVERY_ID_PATTERN.test(deliveryId) ||
    !event ||
    !EVENT_PATTERN.test(event)
  ) {
    throw new AppError(400, 'X-GitHub-Delivery and X-GitHub-Event are required', 'BAD_REQUEST');
  }
  let payload: unknown;
  try {
    payload = JSON.parse(storableJson(raw.toString('utf8')));
  } catch {
    throw new AppError(400, 'The body is not valid JSON', 'INVALID_JSON');
  }
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new AppError(400, 'The body must be a JSON object', 'BAD_REQUEST');
  }
  const fields = payload as Record<string, unknown>;
  const ping = event === 'ping';
  let rerun = false;
  try {
    await prisma.githubDelivery.create({
      data: {
        id: deliveryId,
        event,
        action: typeof fields.action === 'string' ? fields.action.slice(0, 100) : null,
        installationId: idOf(fields.installation),
        repoId: idOf(fields.repository),
        status: ping ? 'IGNORED' : 'PENDING',
        processedAt: ping ? new Date() : null,
        payload: payload as Prisma.InputJsonObject,
      },
    });
  } catch (err) {
    // The unique key is the duplicate check: no read ahead of it, so two copies cannot both pass
    if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) {
      // Only a refusal of the payload's text is kept in the log as given up, without the payload.
      // Anything else (a timeout, a dropped connection) fails the call, so GitHub sees it and
      // the delivery is not lost.
      const state = sqlState(err);
      if (!state || !JSON_TEXT_REFUSALS.has(state)) throw err;
      logger.warn('GitHub payload refused by the database', { deliveryId, sqlState: state });
      await prisma.githubDelivery.create({
        data: {
          id: deliveryId,
          event,
          action: null,
          status: 'FAILED',
          error: 'payload could not be stored',
          processedAt: new Date(),
        },
      });
      return { accepted: true };
    }
    // GitHub's "Redeliver" reuses the id. One that gave up for good runs again, once: the reset
    // only matches while it is still in that state
    const reset = await prisma.githubDelivery.updateMany({
      where: { id: deliveryId, status: 'FAILED', nextAttemptAt: null },
      data: {
        status: 'PENDING',
        attempts: 0,
        error: null,
        processedAt: null,
        payload: payload as Prisma.InputJsonObject,
      },
    });
    if (reset.count === 0) return { duplicate: true };
    rerun = true;
  }
  if (!ping || rerun) {
    setImmediate(() => {
      processDelivery(deliveryId).catch((err: unknown) => {
        logger.error('GitHub delivery failed to run', { deliveryId }, err as Error);
      });
    });
  }
  return { accepted: true };
}

// ---- Processing

/**
 * A failure's message for the log: the message only, with no secret of the App in it, cut to
 * 500 characters. Scrubbed before it is cut, so a cut cannot leave half a secret behind.
 * @param err What the handler threw
 */
async function errorText(err: unknown): Promise<string> {
  let text = err instanceof Error ? err.message : String(err);
  try {
    const app = await getGithubAppSecrets();
    for (const secret of [app?.webhookSecret, app?.clientSecret, app?.privateKey]) {
      if (secret) text = text.split(secret).join('[secret]');
    }
  } catch {
    // The secrets cannot be read: say nothing of the failure rather than risk quoting one
    text = 'The handler failed';
  }
  return text.slice(0, ERROR_MAX);
}

/**
 * Runs the handlers of one delivery. The delivery is claimed with one conditional update, so two
 * workers (or a retry and the first run) never both run it; a claim also leases it for five
 * minutes. A handler that throws leaves the delivery FAILED with a retry time, up to five attempts.
 * @param id The delivery id
 */
export async function processDelivery(id: string): Promise<void> {
  const now = new Date();
  const claim = await prisma.githubDelivery.updateMany({
    where: {
      id,
      status: { in: ['PENDING', 'FAILED'] },
      attempts: { lt: MAX_ATTEMPTS },
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
    },
    data: { attempts: { increment: 1 }, nextAttemptAt: new Date(now.getTime() + LEASE_MS) },
  });
  if (claim.count === 0) return;
  const row = await prisma.githubDelivery.findUnique({ where: { id } });
  if (!row) return;
  const context: GithubDeliveryContext = {
    deliveryId: row.id,
    event: row.event,
    action: row.action,
    installationId: row.installationId,
    repoId: row.repoId,
    payload: (row.payload ?? {}) as Record<string, unknown>,
    receivedAt: row.receivedAt,
  };
  try {
    let processed = false;
    for (const handler of handlersFor(row.event)) {
      if ((await handler(context)) === 'processed') processed = true;
    }
    // Only while this is still the claimed attempt: a run that outlived its lease must not
    // overwrite the run that claimed the delivery after it
    await prisma.githubDelivery.updateMany({
      where: { id, attempts: row.attempts },
      data: {
        status: processed ? 'PROCESSED' : 'IGNORED',
        processedAt: new Date(),
        nextAttemptAt: null,
        error: null,
      },
    });
  } catch (err) {
    const wait = BACKOFF_MINUTES[row.attempts - 1];
    await prisma.githubDelivery.updateMany({
      where: { id, attempts: row.attempts },
      data: {
        status: 'FAILED',
        error: await errorText(err),
        nextAttemptAt: wait === undefined ? null : new Date(Date.now() + wait * 60_000),
      },
    });
  }
}

/**
 * Runs the deliveries that are due: failed ones past their retry time, claimed ones whose lease
 * ran out, and stored ones whose first run never started.
 * @param limit The most to run in one round
 * @returns How many it ran
 */
export async function retryDueDeliveries(limit = 50): Promise<number> {
  const now = new Date();
  // A 5th attempt that never finished (the process died): its lease ran out and no claim can
  // take it again, so it ends here
  await prisma.githubDelivery.updateMany({
    where: {
      status: { in: ['PENDING', 'FAILED'] },
      attempts: { gte: MAX_ATTEMPTS },
      nextAttemptAt: { lte: now },
    },
    data: {
      status: 'FAILED',
      nextAttemptAt: null,
      error: `gave up after ${MAX_ATTEMPTS} attempts`,
    },
  });
  const due = await prisma.githubDelivery.findMany({
    where: {
      status: { in: ['PENDING', 'FAILED'] },
      attempts: { lt: MAX_ATTEMPTS },
      OR: [
        { nextAttemptAt: { lte: now } },
        {
          status: 'PENDING',
          nextAttemptAt: null,
          receivedAt: { lte: new Date(now.getTime() - FIRST_RUN_GRACE_MS) },
        },
      ],
    },
    orderBy: { receivedAt: 'asc' },
    take: limit,
    select: { id: true },
  });
  for (const { id } of due) await processDelivery(id);
  return due.length;
}

/** Drops the payload of finished and failed deliveries after 7 days and deletes every delivery after 30. */
export async function cleanupDeliveries(): Promise<void> {
  const now = Date.now();
  await prisma.githubDelivery.updateMany({
    where: {
      status: { in: ['PROCESSED', 'IGNORED', 'FAILED'] },
      receivedAt: { lt: new Date(now - PAYLOAD_DAYS * DAY_MS) },
      NOT: { payload: { equals: Prisma.DbNull } },
    },
    data: { payload: Prisma.DbNull },
  });
  await prisma.githubDelivery.deleteMany({
    where: { receivedAt: { lt: new Date(now - ROW_DAYS * DAY_MS) } },
  });
}
