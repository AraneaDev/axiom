import { execSync } from 'child_process';

/**
 * Build the editor core bundle (dist-editor-core/editor-core.cjs) when it is missing
 * or older than its sources, so a bare `vitest` run never tests a stale bundle.
 */
export async function setup() {
  execSync('node scripts/build-editor-core.mjs --if-stale', {
    stdio: 'inherit',
    cwd: process.cwd(),
  });
}
