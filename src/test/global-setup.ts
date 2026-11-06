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

  // db push runs no migration, and teardown truncates every table: put back the rows a
  // migration inserts (same statement as prisma/migrations/*_github_integration_user)
  const { Pool } = await import('pg');
  const pool = new Pool({ connectionString: testUrl });
  try {
    await pool.query(
      `INSERT INTO "users" ("id", "email", "username", "displayName", "passwordHash", "kind", "createdAt", "updatedAt")
       VALUES ('github-integration', 'github-integration@users.invalid', 'github-integration', 'GitHub', '!', 'INTEGRATION', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
    );
  } finally {
    await pool.end();
  }
}

/**
 *
 */
export async function teardown() {
  const { truncateAllTables, disconnectPrisma } = await import('./test-utils');
  await truncateAllTables();
  await disconnectPrisma();
}
