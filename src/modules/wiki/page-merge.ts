/**
 * The server side of merging an external change into a live (or ended) editing session:
 * the three texts for the browser's three-way merge, and applying the merged result.
 */
import { prisma } from '../../config/database';
import { normalizeMarkdown } from '../../lib/editor-core';
import { AppError } from '../../middleware/errorHandler';
import {
  announceMergeResolved,
  flushRoom,
  getLiveRoom,
  lockRoom,
  replaceRoomContent,
  roomMarkdown,
} from '../../realtime/collaboration';
import { draftIsMergeSide, markRoomMerged } from '../../realtime/yjs-persistence';

import { createPageVersion, lockPage } from './page-versions';
import { finishPageWrite, SyncIssueLinks } from './page-writes';

export interface PendingMerge {
  base: string;
  /** The side the person merging is working on: the live session, or an ended session's draft */
  ours: string;
  /** The other side: the external change, or an ended session's draft */
  theirs: string;
  /** "Yours" for the live session, "<name>'s session" for a draft */
  oursLabel: string;
  /**
   * The external change's author; "Current page" when sessions saved edits on top of it since;
   * "<name>'s session" for a draft
   */
  theirsLabel: string;
  externalVersionId: string;
  /** Author and time of the external change */
  authorName: string;
  at: string;
  /** Set when one side is an ended session's unmerged draft */
  draftAuthorName?: string;
  draftAt?: string;
}

const STALE_MERGE = 'This page changed again: reload the pending merge';

/**
 * Display name for a user id.
 * @param userId
 */
async function nameOf(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { displayName: true, username: true },
  });
  return user?.displayName ?? user?.username ?? 'Unknown';
}

/**
 * The three texts to merge for a page with a pending external change, all normalised so the
 * merge sees no differences that are only formatting.
 *
 * - base: the body the external change replaced.
 * - A live session opened before the change: ours = the session, theirs = Page.body.
 * - A live session opened after the change (it holds the change and its own edits) while a
 *   session open at the time of the change left an unmerged draft: ours = the live session,
 *   theirs = that draft. Drafts of sessions opened after the change never take this place.
 * - Nobody editing: ours = the unmerged draft (or the base), theirs = Page.body.
 * @param pageId - The page
 * @param _userId - The user asking (permission is checked by the caller)
 * @returns The merge input, or null when nothing is pending
 */
export async function getPendingMerge(
  pageId: string,
  _userId: string,
): Promise<PendingMerge | null> {
  const pending = await prisma.pendingPageChange.findUnique({
    where: { pageId },
    include: {
      externalVersion: { select: { createdAt: true, version: true } },
      page: { select: { body: true } },
      draftVersion: {
        select: {
          body: true,
          createdAt: true,
          author: { select: { displayName: true, username: true } },
        },
      },
    },
  });
  if (!pending) return null;

  const authorName = await nameOf(pending.authorId);
  const draft = pending.draftVersion;
  const draftLabel = draft ? `${draft.author.displayName ?? draft.author.username}'s session` : '';
  const draftInfo = draft
    ? {
        draftAuthorName: draft.author.displayName ?? draft.author.username,
        draftAt: draft.createdAt.toISOString(),
      }
    : {};

  const room = getLiveRoom(pageId);
  // The same rule decides the room notice, so the notice never names a draft the merge ignores
  const draftIsSide = Boolean(draft) && draftIsMergeSide(pageId, pending, Boolean(room));
  // Page.body is the external change, unless a session that opened after it saved edits on top
  const editedSince = await prisma.pageVersion.count({
    where: {
      pageId,
      version: { gt: pending.externalVersion.version },
      kind: { not: 'SESSION_DRAFT' },
    },
  });
  const currentLabel = editedSince > 0 ? 'Current page' : authorName;

  let sides: Pick<PendingMerge, 'ours' | 'theirs' | 'oursLabel' | 'theirsLabel'>;
  if (room && draft && draftIsSide) {
    // The live session opened after the change, so it holds the change plus its own edits. What
    // is left to merge is the work of the session that was open when the change came in.
    sides = {
      ours: roomMarkdown(room),
      oursLabel: 'Yours',
      theirs: draft.body,
      theirsLabel: draftLabel,
    };
  } else if (room) {
    // The live session predates the change (or holds nothing else to merge with)
    sides = {
      ours: roomMarkdown(room),
      oursLabel: 'Yours',
      theirs: pending.page.body,
      theirsLabel: currentLabel,
    };
  } else {
    // Nobody is editing: the ended session's draft against the page
    sides = {
      ours: draft?.body ?? pending.baseBody,
      oursLabel: draft ? draftLabel : 'Base',
      theirs: pending.page.body,
      theirsLabel: currentLabel,
    };
  }

  return {
    base: normalizeMarkdown(pending.baseBody),
    ours: normalizeMarkdown(sides.ours),
    theirs: normalizeMarkdown(sides.theirs),
    oursLabel: sides.oursLabel,
    theirsLabel: sides.theirsLabel,
    externalVersionId: pending.externalVersionId,
    authorName,
    at: pending.externalVersion.createdAt.toISOString(),
    ...(draftIsSide ? draftInfo : {}),
  };
}

/**
 * Apply a merged body: it becomes Page.body, a MERGE version and, when a session is live, the
 * room's content for everyone. The pending change is cleared.
 * @param pageId - The page
 * @param userId - Who merged
 * @param input - The external version merged against and the merged Markdown
 * @param input.externalVersionId
 * @param input.markdown
 * @param deps - Replaceable dependencies (tests)
 * @param deps.syncIssueLinks
 * @throws {AppError} 409 when the change was merged already or a newer change arrived, or when
 *   another merge is running
 */
export async function applyMerge(
  pageId: string,
  userId: string,
  input: { externalVersionId: string; markdown: string },
  deps: { syncIssueLinks?: SyncIssueLinks } = {},
): Promise<void> {
  const merged = normalizeMarkdown(input.markdown);

  const pending = await prisma.pendingPageChange.findUnique({ where: { pageId } });
  if (!pending || pending.externalVersionId !== input.externalVersionId) {
    throw new AppError(409, STALE_MERGE);
  }

  const byName = await nameOf(userId);
  const release = lockRoom(pageId, byName);
  if (!release) throw new AppError(409, 'Someone else is merging this page');

  try {
    // The session's pre-merge state goes to history first (a draft, while the change is pending)
    await flushRoom(pageId);

    const page = await prisma.$transaction(async (tx) => {
      await lockPage(tx, pageId);
      const current = await tx.pendingPageChange.findUnique({ where: { pageId } });
      if (!current || current.externalVersionId !== input.externalVersionId) {
        throw new AppError(409, STALE_MERGE);
      }
      const row = await tx.page.findUniqueOrThrow({ where: { id: pageId } });
      const updated = await tx.page.update({ where: { id: pageId }, data: { body: merged } });
      await createPageVersion(tx, {
        pageId,
        title: row.title,
        body: merged,
        authorId: userId,
        kind: 'MERGE',
      });
      await tx.pendingPageChange.delete({ where: { pageId } });
      return updated;
    });

    // Right after the commit, with no await in between and the room still locked: record the
    // merged text as what the session and the database agree on, then swap the live content.
    // flushRoom above waited for any save in flight and client updates are dropped while locked,
    // so no save can run between the commit and the swap.
    const room = getLiveRoom(pageId);
    if (room) {
      markRoomMerged(pageId, merged);
      replaceRoomContent(room, merged);
    }
    announceMergeResolved(pageId, byName);
    await finishPageWrite(page, userId, merged, deps.syncIssueLinks);
  } finally {
    release();
  }
}
