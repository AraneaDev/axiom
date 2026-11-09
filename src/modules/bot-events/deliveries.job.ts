import { prisma } from '../../config/database';
import { logger } from '../../utils/logger';

import { deliverDueEvents } from './sender';

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
 * One worker tick: send the due bot events, then, at most once an hour, delete old finished ones.
 * Ticks may overlap, in one worker or several: each event is leased before it is sent.
 */
export async function runBotDeliveries(): Promise<void> {
  await deliverDueEvents();
  if (Date.now() - lastCleanup >= CLEANUP_EVERY_MS) {
    lastCleanup = Date.now();
    await cleanupBotEvents();
  }
}

/** How long shutdown waits for a tick in flight: one last attempt with room to record it */
export const SHUTDOWN_WAIT_MS = 15_000;

let inFlight: Promise<void> | null = null;

/**
 * Start a tick unless one is still running; its failure is logged.
 * @param run - The tick (tests replace it)
 * @returns The tick, or null when the last one has not finished
 */
export function startBotDeliveryTick(
  run: () => Promise<void> = runBotDeliveries,
): Promise<void> | null {
  if (inFlight) return null;
  const tick = run()
    .catch((err) => {
      logger.error('Bot event deliveries failed', {}, err as Error);
    })
    .finally(() => {
      if (inFlight === tick) inFlight = null;
    });
  inFlight = tick;
  return tick;
}

/**
 * Wait for the tick in flight, at most SHUTDOWN_WAIT_MS. An event cut off mid-send stays leased
 * and is sent again after the lease, which its Axiom-Event-Id lets the bot recognise.
 * @returns Whether no tick is still running
 */
export async function waitForBotDeliveryTick(): Promise<boolean> {
  const tick = inFlight;
  if (!tick) return true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const gaveUp = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), SHUTDOWN_WAIT_MS);
  });
  try {
    return await Promise.race([tick.then(() => true as const), gaveUp]);
  } finally {
    clearTimeout(timer);
  }
}
