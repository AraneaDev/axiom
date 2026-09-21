import './config/load-env';

import { prisma } from './config/database';
import { startRunnerHealthMonitor, stopRunnerHealthMonitor } from './modules/runners/runner-health';
import { logger } from './utils/logger';

async function main(): Promise<void> {
  startRunnerHealthMonitor();

  let stopEmail: (() => Promise<void>) | null = null;
  if (process.env.SMTP_HOST) {
    const { startEmailWorker, stopEmailWorker } = await import('./email/queue');
    startEmailWorker();
    stopEmail = stopEmailWorker;
  } else {
    logger.info('SMTP_HOST not set, email worker disabled');
  }

  logger.info('Axiom worker running');

  const shutdown = async (signal: string) => {
    logger.info('Worker shutting down', { signal });
    stopRunnerHealthMonitor();
    if (stopEmail) await stopEmail();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error('Worker failed to start', {}, err as Error);
  process.exit(1);
});
