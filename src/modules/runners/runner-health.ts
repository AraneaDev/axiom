import { prisma } from '../../config/database';
import { logger } from '../../utils/logger';

const STALE_THRESHOLD_MS = 30_000; // 30 seconds
let healthInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Start the background health monitor that marks stale runners as OFFLINE.
 */
export function startRunnerHealthMonitor() {
  healthInterval = setInterval(async () => {
    try {
      const cutoff = new Date(Date.now() - STALE_THRESHOLD_MS);
      const result = await prisma.runner.updateMany({
        where: {
          status: { in: ['IDLE', 'ACTIVE'] },
          lastSeenAt: { lt: cutoff },
        },
        data: { status: 'OFFLINE' },
      });

      if (result.count > 0) {
        logger.info(`Marked ${result.count} stale runner(s) as OFFLINE`);
      }
    } catch (err) {
      logger.error('Runner health check failed', {}, err as Error);
    }
  }, STALE_THRESHOLD_MS);
}

/**
 * Stop the health monitor (for graceful shutdown).
 */
export function stopRunnerHealthMonitor() {
  if (healthInterval) {
    clearInterval(healthInterval);
    healthInterval = null;
  }
}
