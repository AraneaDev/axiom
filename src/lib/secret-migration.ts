import { prisma } from '../config/database';
import { logger } from '../utils/logger';

import {
  SecretBoxError,
  decryptSecret,
  encryptSecret,
  needsReencrypt,
  secretContext,
} from './secret-box';

// Every column that holds a value sealed by the secret box. Each value is sealed with the
// context secretContext(model, field, row id). Plans that add an encrypted column append
// it here, so a key rotation reaches every sealed value.
export const ENCRYPTED_COLUMNS: Array<{ model: string; field: string }> = [
  { model: 'user', field: 'twoFactorSecret' },
  { model: 'githubApp', field: 'clientSecret' },
  { model: 'githubApp', field: 'privateKey' },
  { model: 'githubApp', field: 'webhookSecret' },
  { model: 'githubAccount', field: 'accessToken' },
  { model: 'githubAccount', field: 'refreshToken' },
  { model: 'botWebhook', field: 'secret' },
];

const BATCH = 500;
const ENCRYPTED_PREFIX = 'enc:v1:';

// A row id is a string, or an Int for a model such as GithubApp. The context a value is sealed
// with holds the id as text, so String(id) gives the same context the owning service uses.
type RowId = string | number;
type Row = { id: RowId } & Record<string, RowId | null>;

// The part of a Prisma delegate this module uses, so one loop serves every listed column
interface SecretDelegate {
  findMany(args: {
    where: Record<string, unknown>;
    select: Record<string, true>;
    orderBy: { id: 'asc' };
    take: number;
  }): Promise<Row[]>;
  updateMany(args: {
    where: Record<string, unknown>;
    data: Record<string, string>;
  }): Promise<{ count: number }>;
}

function delegateOf(model: string): SecretDelegate {
  const delegate = (prisma as unknown as Record<string, SecretDelegate | undefined>)[model];
  if (!delegate) throw new Error(`No Prisma model named ${model}`);
  return delegate;
}

/**
 * Walks a column in id order, a batch at a time, over the rows the filter selects.
 * @param delegate The model's delegate.
 * @param field The column.
 * @param where Which rows to visit.
 * @param visit Called once per row with the stored value.
 */
async function eachRow(
  delegate: SecretDelegate,
  field: string,
  where: Record<string, unknown>,
  visit: (id: RowId, stored: string) => Promise<void>,
): Promise<void> {
  let after: RowId | undefined;
  for (;;) {
    const rows = await delegate.findMany({
      where: { ...where, ...(after !== undefined && { id: { gt: after } }) },
      select: { id: true, [field]: true },
      orderBy: { id: 'asc' },
      take: BATCH,
    });
    for (const row of rows) {
      const stored = row[field];
      if (typeof stored === 'string') await visit(row.id, stored);
    }
    if (rows.length < BATCH) return;
    after = rows[rows.length - 1].id;
  }
}

/**
 * Encrypts every 2FA secret still stored in plain text. Each row is written only while it
 * still holds the value read, so a 2FA setup running at the same time is not overwritten.
 * Running it again changes nothing.
 * @returns How many secrets it encrypted.
 */
export async function encryptPlainSecrets(): Promise<{ twoFactor: number }> {
  let twoFactor = 0;
  await eachRow(
    delegateOf('user'),
    'twoFactorSecret',
    {
      twoFactorSecret: { not: null },
      NOT: { twoFactorSecret: { startsWith: ENCRYPTED_PREFIX } },
    },
    async (id, plain) => {
      const sealed = encryptSecret(plain, secretContext('user', 'twoFactorSecret', String(id)));
      const { count } = await prisma.user.updateMany({
        where: { id: String(id), twoFactorSecret: plain },
        data: { twoFactorSecret: sealed },
      });
      twoFactor += count;
    },
  );
  return { twoFactor };
}

/** What a rotation did for one column. */
export interface RotationCount {
  reencrypted: number;
  failed: number;
}

/**
 * Re-encrypts, under the current key, every value of every listed column that is sealed
 * under another key. A row that does not open is counted and logged by id and reason,
 * never by value, and the run goes on with the next row.
 * @returns Per column (`user.twoFactorSecret`), how many rows moved and how many failed.
 */
export async function reencryptAllSecrets(): Promise<Record<string, RotationCount>> {
  const result: Record<string, RotationCount> = {};
  for (const { model, field } of ENCRYPTED_COLUMNS) {
    const counts: RotationCount = { reencrypted: 0, failed: 0 };
    result[`${model}.${field}`] = counts;
    const delegate = delegateOf(model);
    const where = { [field]: { startsWith: ENCRYPTED_PREFIX } };
    await eachRow(delegate, field, where, async (id, stored) => {
      if (!needsReencrypt(stored)) return;
      let sealed: string;
      try {
        const context = secretContext(model, field, String(id));
        sealed = encryptSecret(decryptSecret(stored, context), context);
      } catch (err) {
        counts.failed += 1;
        const reason = err instanceof SecretBoxError ? err.reason : 'invalid-context';
        logger.warn('Secret not re-encrypted', { model, field, id, reason });
        return;
      }
      const { count } = await delegate.updateMany({
        where: { id, [field]: stored },
        data: { [field]: sealed },
      });
      counts.reencrypted += count;
    });
  }
  return result;
}
