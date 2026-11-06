import './config/load-env';

import { prisma } from './config/database';
import { encryptPlainSecrets, reencryptAllSecrets } from './lib/secret-migration';

// Re-encrypts every stored secret under the current instance key, after the plain ones are
// sealed. Run through `npm run secrets:rotate` (scripts/rotate-secrets.ts). Prints counts per
// column, never a value. A row that does not open is logged by id and reason, and the run
// exits 1 so the previous key is not dropped while a value still needs it.

async function main(): Promise<number> {
  const { twoFactor } = await encryptPlainSecrets();
  console.warn(`plain 2FA secrets encrypted: ${twoFactor}`);

  let failed = 0;
  for (const [column, counts] of Object.entries(await reencryptAllSecrets())) {
    console.warn(`${column}: ${counts.reencrypted} re-encrypted, ${counts.failed} failed`);
    failed += counts.failed;
  }
  if (failed > 0) {
    console.error(
      `${failed} secrets did not open with the configured keys. Keep AXIOM_ENCRYPTION_KEY_PREVIOUS ` +
        'until they are resolved; the log names each row and reason.',
    );
    return 1;
  }
  return 0;
}

main()
  .then(async (code) => {
    await prisma.$disconnect();
    process.exit(code);
  })
  .catch(async (err: Error) => {
    // Name and message only: neither carries a value, and the stack is not needed here
    console.error(`Rotation stopped: ${err.name}: ${err.message}`);
    await prisma.$disconnect().catch(() => undefined);
    process.exit(1);
  });
