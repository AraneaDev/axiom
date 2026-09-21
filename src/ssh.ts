import './config/load-env';

import { prisma } from './config/database';
import { startSshServer } from './git/ssh-server';
import { logger } from './utils/logger';

startSshServer()
  .then((server) => {
    const shutdown = (signal: string) => {
      logger.info('SSH server shutting down', { signal });
      server.close(async () => {
        await prisma.$disconnect();
        process.exit(0);
      });
      setTimeout(() => process.exit(1), 10000).unref();
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  })
  .catch((err) => {
    logger.error('SSH server failed to start', {}, err as Error);
    process.exit(1);
  });
