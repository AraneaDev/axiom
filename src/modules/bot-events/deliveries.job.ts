import { prisma } from '../../config/database';

import { deliverDueEvents } from './sender';

/** Only one worker sends at a time: a second one skips its tick */
const LOCK_KEY = 'bot-event-deliveries';
/** Longer than a tick can run (its budget plus one last attempt) */
const TICK_HOLD_MS = 5 * 60_000;
/** Finished deliveries are kept this long */
const KEEP_DAYS = 30;
/** Cleanup runs at most this often, though the tick is every 15 seconds */
const CLEANUP_EVERY_MS = 60 * 60_000;

let lastCleanup = 0;

/**
 * Delete delivered, failed and dropped events older than 30 days. Pending ones stay.
 * @param now - The time to count from
 * @returns How many were deleted
 */
export async function cleanupBotEvents(now = new Date()): Promise<number> {
  const before = new Date(now.getTime() - KEEP_DAYS * 24 * 60 * 60_000);
  const { count } = await prisma.botEvent.deleteMany({
    where: { status: { in: ['DELIVERED', 'FAILED', 'DROPPED'] }, createdAt: { lt: before } },
  });
  return count;
}

/**
 * One worker tick: send the due bot events under an advisory lock, then, at most once an hour,
 * delete old finished ones.
 */
export async function runBotDeliveries(): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      const [{ locked }] = await tx.$queryRaw<
        { locked: boolean }[]
      >`SELECT pg_try_advisory_xact_lock(hashtextextended(${LOCK_KEY}, 0)) AS locked`;
      if (!locked) return;
      await deliverDueEvents();
    },
    { maxWait: 10_000, timeout: TICK_HOLD_MS },
  );
  if (Date.now() - lastCleanup >= CLEANUP_EVERY_MS) {
    lastCleanup = Date.now();
    await cleanupBotEvents();
  }
}
