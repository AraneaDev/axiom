import './config/load-env';

import { execFileSync } from 'child_process';

import { prisma } from './config/database';
import { reinstallAllHooks } from './git/reinstall-hooks';
import { logger } from './utils/logger';

async function main(): Promise<void> {
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], { stdio: 'inherit' });
  const result = await reinstallAllHooks();
  logger.info('Post-receive hooks reinstalled', result);
}

main()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (err) => {
    logger.error('Migrate failed', {}, err as Error);
    await prisma.$disconnect().catch(() => undefined);
    process.exit(1);
  });
