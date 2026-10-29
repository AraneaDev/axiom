import { Prisma } from '@prisma/client';
import type { PageVersion, PageVersionKind } from '@prisma/client';

const MAX_ATTEMPTS = 3;

/**
 * Lock a page row for the rest of the transaction so concurrent writers queue behind it.
 * Callers re-read the page after this call and base their checks on that fresh row.
 * @param tx - Interactive transaction client
 * @param pageId - The page to lock
 */
export async function lockPage(tx: Prisma.TransactionClient, pageId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM pages WHERE id = ${pageId} FOR UPDATE`;
}

export interface CreatePageVersionInput {
  pageId: string;
  title: string;
  body: string;
  authorId: string;
  kind: PageVersionKind;
  changeDescription?: string;
}

/**
 * Create the next version of a page inside a transaction.
 *
 * The page row is locked first so concurrent writers queue up instead of computing the same
 * number. A unique violation on (pageId, version) is still retried, behind a savepoint because
 * Postgres aborts the surrounding transaction on any failed statement.
 * @param tx - Interactive transaction client
 * @param input - Version content, author and kind
 * @returns The created version
 */
export async function createPageVersion(
  tx: Prisma.TransactionClient,
  input: CreatePageVersionInput,
): Promise<PageVersion> {
  await lockPage(tx, input.pageId);

  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    await tx.$executeRawUnsafe('SAVEPOINT page_version_insert');
    try {
      const latest = await tx.pageVersion.aggregate({
        where: { pageId: input.pageId },
        _max: { version: true },
      });
      const version = await tx.pageVersion.create({
        data: {
          pageId: input.pageId,
          version: (latest._max.version ?? 0) + 1,
          title: input.title,
          body: input.body,
          authorId: input.authorId,
          kind: input.kind,
          changeDescription: input.changeDescription,
        },
      });
      await tx.$executeRawUnsafe('RELEASE SAVEPOINT page_version_insert');
      return version;
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') throw err;
      lastError = err;
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT page_version_insert');
    }
  }
  throw lastError;
}
