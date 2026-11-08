// The hourly cap on what live GitHub events import into a linked project. On a public repository
// anyone can open issues and comment, and each new one becomes an Axiom issue or comment (and may
// run rules), so a link takes in at most LIVE_IMPORT_CAP new ones per clock hour. Counted in one
// row per link and hour with a conditional upsert, so concurrent deliveries never take more than
// the cap; the database is the store, so there is nothing to fall back from when Redis is away.
import { Prisma } from '@prisma/client';

import { prisma } from '../../config/database';

/**
 * New issues and new comments live events may import per link and clock hour. Updates of what is
 * imported already are not counted. The backfill (Task 3) does not share this cap: it imports
 * the repository's own open issues once, at its own pace (IMPORT_PACE), and this cap is for what
 * strangers can send.
 */
export const LIVE_IMPORT_CAP = { issues: 100, comments: 300 } as const;
export type ImportCapKind = keyof typeof LIVE_IMPORT_CAP;

const HOUR_MS = 3_600_000;
/** Rows older than this are deleted when a link opens a new hour */
const KEEP_MS = 24 * HOUR_MS;

/** A live import the cap turned away: the delivery is ignored, with this as its reason */
export class ImportCappedError extends Error {
  constructor(
    readonly kind: ImportCapKind,
    readonly resumesAt: Date,
  ) {
    super(
      `The hourly import cap of ${LIVE_IMPORT_CAP[kind]} new ${kind} was reached; import resumes at ${resumesAt.toISOString()}`,
    );
    this.name = 'ImportCappedError';
  }
}

/** @param at A time */
export const hourStartOf = (at: Date) => new Date(Math.floor(at.getTime() / HOUR_MS) * HOUR_MS);

const COLUMNS = {
  issues: { count: Prisma.raw('"issues"'), skipped: Prisma.raw('"skippedIssues"') },
  comments: { count: Prisma.raw('"comments"'), skipped: Prisma.raw('"skippedComments"') },
} as const;

/**
 * Takes one new issue or comment of the link's hour, or counts it as turned away. A creation that
 * then fails gives its slot back with {@link releaseImportSlot}.
 * @param repoLinkId The link
 * @param kind What is about to be imported
 * @param issueNumber For an issue: its number, so a capped issue counts as skipped once however
 *   many of its events arrive
 * @returns The hour the slot belongs to
 * @throws {ImportCappedError} When the hour's cap is reached
 */
export async function takeImportSlot(
  repoLinkId: string,
  kind: ImportCapKind,
  issueNumber?: number,
): Promise<Date> {
  const hourStart = hourStartOf(new Date());
  const { count, skipped } = COLUMNS[kind];
  const taken = await prisma.$queryRaw<{ n: number }[]>`
    INSERT INTO github_import_caps ("repoLinkId", "hourStart", ${count})
    VALUES (${repoLinkId}, ${hourStart}, 1)
    ON CONFLICT ("repoLinkId", "hourStart")
    DO UPDATE SET ${count} = github_import_caps.${count} + 1
    WHERE github_import_caps.${count} < ${LIVE_IMPORT_CAP[kind]}
    RETURNING ${count} AS n`;
  if (taken.length > 0) {
    // The first of a new hour clears the link's old hours
    if (Number(taken[0].n) === 1) {
      await prisma.githubImportCap.deleteMany({
        where: { repoLinkId, hourStart: { lt: new Date(hourStart.getTime() - KEEP_MS) } },
      });
    }
    return hourStart;
  }
  if (kind === 'issues' && issueNumber !== undefined) {
    await prisma.$executeRaw`
      UPDATE github_import_caps
      SET "skippedIssues" = "skippedIssues" + 1,
          "skippedIssueNumbers" = array_append("skippedIssueNumbers", ${issueNumber})
      WHERE "repoLinkId" = ${repoLinkId} AND "hourStart" = ${hourStart}
        AND NOT (${issueNumber} = ANY("skippedIssueNumbers"))`;
  } else {
    await prisma.$executeRaw`
      UPDATE github_import_caps SET ${skipped} = ${skipped} + 1
      WHERE "repoLinkId" = ${repoLinkId} AND "hourStart" = ${hourStart}`;
  }
  throw new ImportCappedError(kind, new Date(hourStart.getTime() + HOUR_MS));
}

/**
 * Gives back a slot whose creation did not happen (it failed, or another run had made it).
 * @param repoLinkId The link
 * @param kind What the slot was for
 * @param hourStart The hour {@link takeImportSlot} gave it from
 */
export async function releaseImportSlot(
  repoLinkId: string,
  kind: ImportCapKind,
  hourStart: Date,
): Promise<void> {
  const { count } = COLUMNS[kind];
  await prisma.$executeRaw`
    UPDATE github_import_caps SET ${count} = ${count} - 1
    WHERE "repoLinkId" = ${repoLinkId} AND "hourStart" = ${hourStart} AND ${count} > 0`;
}

export type ImportCapState = {
  /** Whether live imports of new issues or comments are paused for the rest of the hour */
  paused: boolean;
  /** When the next hour opens again, while paused */
  resumesAt: Date | null;
  issues: { used: number; limit: number; skipped: number };
  comments: { used: number; limit: number; skipped: number };
};

/**
 * The link's cap in the current hour, for the import status and the settings page.
 * @param repoLinkId The link
 */
export async function importCapState(repoLinkId: string): Promise<ImportCapState> {
  const hourStart = hourStartOf(new Date());
  const row = await prisma.githubImportCap.findUnique({
    where: { repoLinkId_hourStart: { repoLinkId, hourStart } },
  });
  const issues = {
    used: row?.issues ?? 0,
    limit: LIVE_IMPORT_CAP.issues,
    skipped: row?.skippedIssues ?? 0,
  };
  const comments = {
    used: row?.comments ?? 0,
    limit: LIVE_IMPORT_CAP.comments,
    skipped: row?.skippedComments ?? 0,
  };
  const paused = issues.used >= issues.limit || comments.used >= comments.limit;
  return {
    paused,
    resumesAt: paused ? new Date(hourStart.getTime() + HOUR_MS) : null,
    issues,
    comments,
  };
}
