import { readFileSync } from 'fs';
import { join } from 'path';

import type { PrismaClient } from '@prisma/client';

const BACKFILL = join(
  __dirname,
  '..',
  'prisma',
  'migrations',
  '20261104150100_backfill_page_mentions',
  'migration.sql',
);

/**
 * Link seeded pages to the issues they name. The seeds write pages directly, after the migration
 * that does this has run, so its one statement runs again here. It only inserts what is missing.
 * @param prisma - The seed's client
 */
export async function seedPageMentions(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(readFileSync(BACKFILL, 'utf-8'));
}
