import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';

export async function createWebhook(repoId: string, data: {
  url: string;
  secret?: string;
  events: string[];
}) {
  return prisma.webhook.create({
    data: {
      repoId,
      url: data.url,
      secret: data.secret,
      events: data.events,
    },
  });
}

export async function listWebhooks(repoId: string) {
  return prisma.webhook.findMany({
    where: { repoId },
    select: { id: true, url: true, events: true, active: true, createdAt: true, updatedAt: true },
    orderBy: { createdAt: 'desc' },
  });
}

export async function getWebhook(webhookId: string) {
  const webhook = await prisma.webhook.findUnique({ where: { id: webhookId } });
  if (!webhook) throw new AppError(404, 'Webhook not found');
  return webhook;
}

export async function updateWebhook(webhookId: string, data: {
  url?: string;
  secret?: string;
  events?: string[];
  active?: boolean;
}) {
  const webhook = await prisma.webhook.findUnique({ where: { id: webhookId } });
  if (!webhook) throw new AppError(404, 'Webhook not found');
  return prisma.webhook.update({ where: { id: webhookId }, data });
}

export async function deleteWebhook(webhookId: string) {
  const webhook = await prisma.webhook.findUnique({ where: { id: webhookId } });
  if (!webhook) throw new AppError(404, 'Webhook not found');
  await prisma.webhook.delete({ where: { id: webhookId } });
}
