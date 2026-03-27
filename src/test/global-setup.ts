import { execSync } from 'child_process';

/**
 *
 */
export async function setup() {
  const testUrl = 'postgresql://axiom:axiom_dev@localhost:5432/axiom_test?schema=public';

  // Push schema to test database (no migration history needed for tests)
  execSync(`DATABASE_URL="${testUrl}" npx prisma db push`, {
    stdio: 'inherit',
    cwd: process.cwd(),
  });
}
