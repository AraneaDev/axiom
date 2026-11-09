import { prisma } from '../../config/database';
import { logger } from '../../utils/logger';
import { createNotification } from '../notifications/notifications.service';

import { SERVICE_ACCOUNT_NOTICE } from './bot-guards';
import { eligibleOwnerIds } from './owners';

/** How long before a bot token expires its owners hear of it (decision 7) */
export const EXPIRY_NOTICE_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Tell the owners of each bot token that expires within two weeks, once per token. A rotated
 * token is left out: it ends in its grace week and its replacement is new, so the replacement's
 * own notice comes later. Each token is claimed (expiryNotifiedAt set) before its owners are
 * told, so two workers never tell twice; a notice that fails is logged, not retried. A token of
 * a bot with no owner is not claimed: the first run after it gets one tells that owner.
 * @param now - The time to count from
 * @returns How many tokens were noticed
 */
export async function notifyExpiringBotTokens(now = new Date()): Promise<number> {
  const until = new Date(now.getTime() + EXPIRY_NOTICE_DAYS * DAY_MS);
  const tokens = await prisma.apiToken.findMany({
    where: {
      expiryNotifiedAt: null,
      rotatedAt: null,
      expiresAt: { gt: now, lte: until },
      user: { kind: 'SERVICE' },
    },
    select: {
      id: true,
      name: true,
      userId: true,
      expiresAt: true,
      user: { select: { displayName: true } },
    },
    orderBy: { expiresAt: 'asc' },
  });
  let noticed = 0;
  for (const token of tokens) {
    // An orphan has nobody to tell: its token stays unclaimed until an owner can hear of it
    let owners: string[];
    try {
      owners = await eligibleOwnerIds(token.userId);
    } catch (err) {
      logger.error('reading the owners of a bot token failed', { tokenId: token.id }, err as Error);
      continue;
    }
    if (owners.length === 0) continue;
    const claimed = await prisma.apiToken.updateMany({
      where: { id: token.id, expiryNotifiedAt: null },
      data: { expiryNotifiedAt: now },
    });
    if (claimed.count === 0) continue;
    noticed++;
    const date = token.expiresAt!.toISOString().slice(0, 10);
    try {
      for (const ownerId of owners) {
        await createNotification(
          ownerId,
          SERVICE_ACCOUNT_NOTICE,
          `Token ${token.name} of ${token.user.displayName} expires on ${date}`,
          'Rotate it before then to keep the bot working',
        );
      }
    } catch (err) {
      logger.error(
        'telling about an expiring bot token failed',
        { tokenId: token.id },
        err as Error,
      );
    }
  }
  return noticed;
}
