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

// A ZodError from the env check lists what is wrong with each variable; its messages name
// the variable and the rule, never the value
function startFailure(err: Error & { issues?: Array<{ path: PropertyKey[]; message: string }> }) {
  if (err.name === 'ZodError' && Array.isArray(err.issues)) {
    return err.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
  }
  return `${err.name}: ${err.message.split('\n')[0]}`;
}

import(existsSync(source) ? source : built).catch((err: Error) => {
  // A missing build or a broken entry: one line, without the paths of a stack
  console.error(`secrets:rotate could not start: ${startFailure(err)}`);
  process.exit(1);
});
