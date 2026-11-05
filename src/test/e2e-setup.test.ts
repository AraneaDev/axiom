import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

const setup = readFileSync(path.join(process.cwd(), 'e2e/global-setup.ts'), 'utf-8');
const runner = readFileSync(path.join(process.cwd(), 'scripts/run-e2e.sh'), 'utf-8');

describe('the e2e database', () => {
  it('gets its schema from the migrations, as the migrate container gives it', () => {
    expect(setup).toContain('prisma migrate deploy');
    // A pushed schema makes the migrate container fail with P3005 and P3009
    expect(setup).not.toContain('db push');
  });

  it('starts over when an earlier run left a schema without migration history', () => {
    expect(runner).toContain('_prisma_migrations');
    expect(runner).toContain('DROP DATABASE axiom_e2e');
  });
});
