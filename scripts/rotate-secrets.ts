/**
 * Re-encrypts every stored secret under the current instance key. Run it after a key
 * rotation, with the old key as AXIOM_ENCRYPTION_KEY_PREVIOUS and the new one as
 * AXIOM_ENCRYPTION_KEY. Secrets still in plain text are sealed first.
 *
 * Usage: npm run secrets:rotate
 *
 * The work lives in src/rotate-secrets.ts. A checkout runs that source; the production
 * image carries no src/ and runs its build in dist/ instead.
 */

import { existsSync } from 'fs';
import { resolve } from 'path';

const source = resolve(__dirname, '../src/rotate-secrets.ts');
const built = resolve(__dirname, '../dist/rotate-secrets.js');

import(existsSync(source) ? source : built).catch((err: Error) => {
  // A missing build or a broken entry: one line, without the paths of a stack
  console.error(`secrets:rotate could not start: ${err.name}: ${err.message.split('\n')[0]}`);
  process.exit(1);
});
