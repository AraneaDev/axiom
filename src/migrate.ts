import './config/load-env';

import { execFileSync } from 'child_process';

import { prisma } from './config/database';
import { encryptPlainSecrets } from './lib/secret-migration';
import { logger } from './utils/logger';

async function main(): Promise<void> {
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], { stdio: 'inherit' });
  // Secrets kept in plain text before the instance key existed; a no-op once they are sealed
  const { twoFactor } = await encryptPlainSecrets();
  if (twoFactor > 0) logger.info('Encrypted plain 2FA secrets', { count: twoFactor });
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
