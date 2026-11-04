import './config/load-env';

import { prisma } from './config/database';
import { cleanupExpiredUploads } from './modules/attachments/upload-intents.service';
import { logger } from './utils/logger';

const UPLOAD_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

/** Remove expired upload URLs and staged attachments; a failure waits for the next round. */
function runUploadCleanup(): void {
  cleanupExpiredUploads().catch((err) => {
    logger.error('Upload cleanup failed', {}, err as Error);
  });
}

async function main(): Promise<void> {
  let stopEmail: (() => Promise<void>) | null = null;
  if (process.env.SMTP_HOST) {
    const { startEmailWorker, stopEmailWorker } = await import('./email/queue');
    startEmailWorker();
    stopEmail = stopEmailWorker;
  } else {
    logger.info('SMTP_HOST not set, email worker disabled');
  }

  runUploadCleanup();
  const uploadCleanup = setInterval(runUploadCleanup, UPLOAD_CLEANUP_INTERVAL_MS);

  logger.info('Axiom worker running');

  const shutdown = async (signal: string) => {
    logger.info('Worker shutting down', { signal });
    clearInterval(uploadCleanup);
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
