import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

import { describe, it, expect } from 'vitest';

import { prisma } from '../../config/database';
import { typedCustomFieldValue } from '../../lib/query-engine';

const MIGRATIONS_DIR = join(process.cwd(), 'prisma', 'migrations');

/** The backfill's date function, as the migration defines it. */
function loadDateFunction(): string {
  const dir = readdirSync(MIGRATIONS_DIR).find((d) => d.endsWith('_custom_field_typed_values'));
  if (!dir) throw new Error('custom_field_typed_values migration directory not found');
  const sql = readFileSync(join(MIGRATIONS_DIR, dir, 'migration.sql'), 'utf8');
  const fn = /CREATE FUNCTION pg_temp\.cf_date[\s\S]*?\$\$ LANGUAGE plpgsql[^;]*;/.exec(sql);
  if (!fn) throw new Error('cf_date not found in the migration');
  return fn[0];
}

const VALUES = [
  '2026-01-15',
  '  2026-01-15 ',
  '2026-01-15T10:00',
  '2026-01-15 23:30:15',
  '2026-01-15T10:00:00Z',
  '2026-01-15T10:00+02:00',
];

describe('custom_field_typed_values migration', () => {
  it.each(['UTC', 'Asia/Tokyo', 'America/Los_Angeles'])(
    'reads dates as typedCustomFieldValue does, in a session on %s',
    async (zone) => {
      const read = await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL TIME ZONE '${zone}'`);
        await tx.$executeRawUnsafe(loadDateFunction());
        const out: string[] = [];
        for (const value of VALUES) {
          const rows = await tx.$queryRawUnsafe<Array<{ read: string }>>(
            `SELECT to_char(pg_temp.cf_date($1), 'YYYY-MM-DD"T"HH24:MI:SS') AS read`,
            value,
          );
          out.push(rows[0].read);
        }
        await tx.$executeRawUnsafe('DROP FUNCTION pg_temp.cf_date(TEXT)');
        return out;
      });
      const expected = VALUES.map((value) =>
        typedCustomFieldValue(value).dateValue?.toISOString().slice(0, 19),
      );
      expect(read).toEqual(expected);
    },
  );
});
