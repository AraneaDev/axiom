import { execFileSync } from 'child_process';
import path from 'path';

import { describe, it, expect } from 'vitest';

/**
 * The dev stack, docker dev and e2e run the backend under tsx. A dynamic import() of
 * y-protocols/lib0 there loads the ESM build and with it a second yjs. This runs the
 * collab server's module under tsx and checks Yjs stayed single.
 */
describe('collab server under tsx', () => {
  it('loads exactly one yjs', () => {
    const script = path.resolve(__dirname, '..', 'test', 'collab-single-yjs-probe.ts');
    const out = execFileSync('npx', ['tsx', script], {
      cwd: path.resolve(__dirname, '..', '..'),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NODE_ENV: 'test' },
    });
    expect(out).toContain('probe-ok');
  }, 60000);
});
