import { randomBytes, randomUUID } from 'crypto';

import { prisma } from '../../config/database';
import { decryptSecret, encryptSecret, secretContext } from '../../lib/secret-box';
import { AppError } from '../../middleware/errorHandler';
import { checkTeamRead } from '../../middleware/rbac';

import { assertWebhookUrl } from './webhook-url';

const DELIVERY_LIMIT = 50;

export type WebhookView = {
  url: string;
  status: 'ACTIVE' | 'PAUSED';
  consecutiveFailures: number;
  pausedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type DeliveryView = {
  id: string;
  type: string;
  status: 'PENDING' | 'DELIVERED' | 'FAILED' | 'DROPPED';
  attempts: number;
  lastStatusCode: number | null;
  lastError: string | null;
  createdAt: Date;
  lastAttemptAt: Date | null;
  deliveredAt: Date | null;
  issueKey: string | null;
};

/**
 * The webhook as the UI sees it: never the secret.
 * @param row - The stored row
 */
function view(row: WebhookView): WebhookView {
  return {
    url: row.url,
    status: row.status,
    consecutiveFailures: row.consecutiveFailures,
    pausedAt: row.pausedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** A new signing secret */
function newSecret(): string {
  return `whsec_${randomBytes(32).toString('base64url')}`;
}

const sealed = (id: string, secret: string) =>
  encryptSecret(secret, secretContext('botWebhook', 'secret', id));

/**
 * Read the signing secret of a webhook row.
 * @param webhook - The row
 * @param webhook.id - Its id
 * @param webhook.secret - The stored, sealed secret
 */
export function readBotWebhookSecret(webhook: { id: string; secret: string }): string {
  return decryptSecret(webhook.secret, secretContext('botWebhook', 'secret', webhook.id));
}

/**
 * Set the URL of a bot's webhook. A first call creates it with a secret, returned only here; a
 * later one changes the URL alone.
 * @param botId - The bot's user id
 * @param url - Where events are sent
 * @throws {AppError} 400 when the URL is refused
 */
export async function setBotWebhook(
  botId: string,
  url: string,
): Promise<{ webhook: WebhookView; secret?: string }> {
  await assertWebhookUrl(url);
  const existing = await prisma.botWebhook.findUnique({ where: { botId } });
  if (existing) {
    const row = await prisma.botWebhook.update({ where: { botId }, data: { url } });
    return { webhook: view(row) };
  }
  const id = randomUUID();
  const secret = newSecret();
  try {
    const row = await prisma.botWebhook.create({
      data: { id, botId, url, secret: sealed(id, secret) },
    });
    return { webhook: view(row), secret };
  } catch (err) {
    // A second request created it first: this one only changes the URL
    if ((err as { code?: string }).code !== 'P2002') throw err;
    const row = await prisma.botWebhook.update({ where: { botId }, data: { url } });
    return { webhook: view(row) };
  }
}

/**
 * Give a bot's webhook a new secret; the old one stops signing at once.
 * @param botId - The bot's user id
 * @returns The new secret, shown once
 * @throws {AppError} 404 when the bot has no webhook
 */
export async function rotateBotWebhookSecret(botId: string): Promise<{ secret: string }> {
  const row = await prisma.botWebhook.findUnique({ where: { botId } });
  if (!row) throw new AppError(404, 'This bot has no webhook');
  const secret = newSecret();
  await prisma.botWebhook.update({ where: { botId }, data: { secret: sealed(row.id, secret) } });
  return { secret };
}

/**
 * Remove a bot's webhook and the events still waiting to be sent.
 * @param botId - The bot's user id
 */
export async function deleteBotWebhook(botId: string): Promise<void> {
  await prisma.$transaction([
    prisma.botEvent.deleteMany({ where: { botId, status: 'PENDING' } }),
    prisma.botWebhook.deleteMany({ where: { botId } }),
  ]);
}

/**
 * Start a paused webhook again.
 * @param botId - The bot's user id
 * @throws {AppError} 404 when the bot has no webhook
 */
export async function resumeBotWebhook(botId: string): Promise<WebhookView> {
  const existing = await prisma.botWebhook.findUnique({ where: { botId } });
  if (!existing) throw new AppError(404, 'This bot has no webhook');
  const row = await prisma.botWebhook.update({
    where: { botId },
    data: { status: 'ACTIVE', consecutiveFailures: 0, pausedAt: null },
  });
  return view(row);
}

/**
 * The key of the issue an event is about, when the payload names it and the viewer can read its
 * project. The payload is written elsewhere, so it is read defensively.
 * @param payload - The stored payload
 * @param viewerId - Who is looking
 * @param readable - Per project, whether the viewer can read it
 */
async function issueKeyFor(
  payload: unknown,
  viewerId: string,
  readable: Map<string, Promise<boolean>>,
): Promise<string | null> {
  const p = payload as { issue?: { key?: unknown }; project?: { id?: unknown } } | null;
  const key = p?.issue?.key;
  const projectId = p?.project?.id;
  if (typeof key !== 'string' || typeof projectId !== 'string') return null;
  let ok = readable.get(projectId);
  if (!ok) {
    ok = (async () => {
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: { teamId: true },
      });
      return project ? (await checkTeamRead(viewerId, project.teamId)) === 'ok' : false;
    })();
    readable.set(projectId, ok);
  }
  return (await ok) ? key : null;
}

/**
 * A bot's webhook and its latest deliveries.
 * @param botId - The bot's user id
 * @param viewerId - Who is looking: an issue key shows only for a project they can read
 */
export async function getBotWebhook(
  botId: string,
  viewerId: string,
): Promise<{ webhook: WebhookView | null; deliveries: DeliveryView[] }> {
  const [webhook, events] = await Promise.all([
    prisma.botWebhook.findUnique({ where: { botId } }),
    prisma.botEvent.findMany({
      where: { botId },
      orderBy: { seq: 'desc' },
      take: DELIVERY_LIMIT,
    }),
  ]);
  const readable = new Map<string, Promise<boolean>>();
  const deliveries: DeliveryView[] = [];
  for (const e of events) {
    deliveries.push({
      id: e.id,
      type: e.type,
      status: e.status,
      attempts: e.attempts,
      lastStatusCode: e.lastStatusCode,
      lastError: e.lastError,
      createdAt: e.createdAt,
      lastAttemptAt: e.lastAttemptAt,
      deliveredAt: e.deliveredAt,
      issueKey: await issueKeyFor(e.payload, viewerId, readable),
    });
  }
  return { webhook: webhook ? view(webhook) : null, deliveries };
}
