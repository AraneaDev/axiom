import crypto from 'crypto';

import bcrypt from 'bcryptjs';

import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { logger } from '../../utils/logger';

/**
 *
 * @param data
 * @param data.name
 * @param data.token
 * @param data.labels
 * @param data.version
 */
export async function registerRunner(data: {
  name: string;
  token: string;
  labels: string[];
  version: string;
}) {
  const regTokens = await prisma.runnerRegistrationToken.findMany({
    where: {
      usedBy: null,
      expiresAt: { gt: new Date() },
    },
    take: 100,
    orderBy: { createdAt: 'desc' },
  });

  let matchedToken: (typeof regTokens)[0] | null = null;
  for (const rt of regTokens) {
    if (await bcrypt.compare(data.token, rt.tokenHash)) {
      matchedToken = rt;
      break;
    }
  }

  if (!matchedToken) {
    throw new AppError(400, 'Invalid or expired registration token');
  }

  const uuid = crypto.randomUUID();
  const plainToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = await bcrypt.hash(plainToken, 10);

  const runner = await prisma.runner.create({
    data: {
      uuid,
      name: data.name,
      tokenHash,
      status: 'IDLE',
      labels: data.labels,
      version: data.version,
      scopeType: matchedToken.scopeType,
      scopeId: matchedToken.scopeId,
      lastSeenAt: new Date(),
    },
  });

  await prisma.runnerRegistrationToken.update({
    where: { id: matchedToken.id },
    data: { usedBy: runner.id },
  });

  logger.info('Runner registered', { uuid, name: data.name, scopeType: matchedToken.scopeType });

  return {
    runner: {
      uuid: runner.uuid,
      token: plainToken,
      name: runner.name,
    },
  };
}

/**
 *
 * @param runnerId
 * @param data
 * @param data.version
 * @param data.labels
 */
export async function declareRunner(runnerId: string, data: { version: string; labels: string[] }) {
  const runner = await prisma.runner.update({
    where: { id: runnerId },
    data: {
      version: data.version,
      labels: data.labels,
      status: 'IDLE',
      lastSeenAt: new Date(),
    },
  });

  return {
    runner: {
      uuid: runner.uuid,
      name: runner.name,
      status: runner.status,
    },
  };
}
