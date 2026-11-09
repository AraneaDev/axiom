import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

import '../index';

import { listActions } from './registry';

/**
 * An action whose result carries a secret (redactResult) shows it once, to the person who approves
 * it, on the request's own page. The approvals list must send its requests there instead of
 * approving in place, so the frontend names each such action.
 */
describe('actions whose result is a secret', () => {
  it('are all named in the frontend list of SECRET_RESULT_ACTIONS', () => {
    const source = readFileSync(
      path.join(__dirname, '../../frontend/src/lib/agent-approvals.ts'),
      'utf8',
    );
    const block = /SECRET_RESULT_ACTIONS[^=]*=\s*new Set\(\[([^\]]*)\]/.exec(source)?.[1] ?? '';
    const named = [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
    const secret = listActions()
      .filter((a) => a.redactResult)
      .map((a) => a.name)
      .sort();
    expect(secret.length).toBeGreaterThan(0);
    expect(named).toEqual(secret);
  });
});
