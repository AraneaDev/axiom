import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';

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

  // db push runs no migration, and teardown truncates every table: put back the rows the
  // migration inserts, taking the statement from the migration itself
  const migration = readFileSync(
    join(process.cwd(), 'prisma/migrations/20261106140000_github_integration_user/migration.sql'),
    'utf8',
  );
  const insert = /INSERT INTO[\s\S]*?;/.exec(migration)?.[0];
  if (!insert) throw new Error('The integration user migration has no INSERT statement');
  const { Pool } = await import('pg');
  const pool = new Pool({ connectionString: testUrl });
  try {
    await pool.query(insert);
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
