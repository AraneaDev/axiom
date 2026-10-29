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
import { setLoadedSnapshot } from '../../realtime/yjs-persistence';

import { createPageVersion, lockPage } from './page-versions';
import { finishPageWrite, SyncIssueLinks } from './page-writes';

export interface PendingMerge {
  base: string;
  theirs: string;
  ours: string;
  externalVersionId: string;
  authorName: string;
  at: string;
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
 * - theirs: Page.body, the external change.
 * - ours: the live room's document when that room holds state the database does not (it was
 *   opened before the change, or it has been edited since it loaded). Otherwise the latest
 *   session draft written since the change, or the base when there is none.
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
      externalVersion: { select: { createdAt: true } },
      page: { select: { body: true } },
    },
  });
  if (!pending) return null;

  let ours: string | undefined;
  const room = getLiveRoom(pageId);
  if (room) {
    const live = roomMarkdown(room);
    const openedBeforeChange = room.pendingIdAtLoad !== pending.id;
    if (openedBeforeChange || live !== room.loadedBody) ours = live;
  }
  if (ours === undefined) {
    const draft = await prisma.pageVersion.findFirst({
      where: { pageId, kind: 'SESSION_DRAFT', createdAt: { gte: pending.createdAt } },
      orderBy: { version: 'desc' },
      select: { body: true },
    });
    ours = draft?.body ?? pending.baseBody;
  }

  return {
    base: normalizeMarkdown(pending.baseBody),
    theirs: normalizeMarkdown(pending.page.body),
    ours: normalizeMarkdown(ours),
    externalVersionId: pending.externalVersionId,
    authorName: await nameOf(pending.authorId),
    at: pending.externalVersion.createdAt.toISOString(),
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

      // Swap the live content while the page row is locked: a room save waiting on the lock then
      // finds the merged text already stored and writes nothing over it
      const room = getLiveRoom(pageId);
      if (room) replaceRoomContent(room, merged);

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

    // The merged text is now what the live session and the database agree on
    if (getLiveRoom(pageId)) setLoadedSnapshot(pageId, merged);
    announceMergeResolved(pageId, byName);
    await finishPageWrite(page, userId, merged, deps.syncIssueLinks);
  } finally {
    release();
  }
}
