import { prisma } from '../../config/database';
import { dispatchWebhook } from '../../git/hook-handler';
import { AppError } from '../../middleware/errorHandler';
import { findOrThrow } from '../../utils/find-or-throw';

/**
 *
 * @param repoId
 * @param data
 * @param data.url
 * @param data.secret
 * @param data.events
 */
export async function createWebhook(
  repoId: string,
  data: {
    url: string;
    secret?: string;
    events: string[];
  },
) {
  return prisma.webhook.create({
    data: {
      repoId,
      url: data.url,
      secret: data.secret,
      events: data.events,
    },
  });
}

/**
 *
 * @param repoId
 */
export async function listWebhooks(repoId: string) {
  return prisma.webhook.findMany({
    where: { repoId },
    select: { id: true, url: true, events: true, active: true, createdAt: true, updatedAt: true },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 *
 * @param webhookId
 */
export async function getWebhook(webhookId: string) {
  const webhook = await findOrThrow(
    prisma.webhook.findUnique({ where: { id: webhookId } }),
    'Webhook not found',
  );
  return webhook;
}

/**
 *
 * @param webhookId
 * @param data
 * @param data.url
 * @param data.secret
 * @param data.events
 * @param data.active
 */
export async function updateWebhook(
  webhookId: string,
  data: {
    url?: string;
    secret?: string;
    events?: string[];
    active?: boolean;
  },
) {
  await findOrThrow(prisma.webhook.findUnique({ where: { id: webhookId } }), 'Webhook not found');
  return prisma.webhook.update({ where: { id: webhookId }, data });
}

/**
 *
 * @param webhookId
 */
export async function deleteWebhook(webhookId: string) {
  await findOrThrow(prisma.webhook.findUnique({ where: { id: webhookId } }), 'Webhook not found');
  await prisma.webhook.delete({ where: { id: webhookId } });
}

/**
 * List recent deliveries for a webhook.
 * @param webhookId
 */
export async function listDeliveries(webhookId: string) {
  await findOrThrow(prisma.webhook.findUnique({ where: { id: webhookId } }), 'Webhook not found');
  return prisma.webhookDelivery.findMany({
    where: { webhookId },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
}

/**
 * Redeliver a webhook delivery.
 * @param webhookId
 * @param deliveryId
 */
export async function redeliverWebhook(webhookId: string, deliveryId: string) {
  const delivery = await prisma.webhookDelivery.findUnique({ where: { id: deliveryId } });
  if (!delivery || delivery.webhookId !== webhookId) {
    throw new AppError(404, 'Delivery not found');
  }
  const webhook = await findOrThrow(
    prisma.webhook.findUnique({ where: { id: webhookId } }),
    'Webhook not found',
  );

  const payload = delivery.requestBody ? JSON.parse(delivery.requestBody) : {};
  await dispatchWebhook(webhook.id, webhook.url, webhook.secret, payload, 1);
  return { ok: true };
}
