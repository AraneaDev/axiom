/**
 * Yjs persistence layer backed by Prisma/PostgreSQL.
 * Loads wiki page body into Yjs docs on first access,
 * and debounce-saves merged content back to the DB.
 */

import * as Y from 'yjs';

import { prisma } from '../config/database';
import { markdownToYFragment, normalizeMarkdown, yFragmentToMarkdown } from '../lib/editor-core';
import { createPageVersion, lockPage } from '../modules/wiki/page-versions';
import { logger } from '../utils/logger';

const SAVE_DEBOUNCE_MS = 5_000;

/** Map of pageId -> debounce timer */
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Map of pageId -> serialization of the doc as loaded, so sessions without edits do not persist */
const loadedSnapshots = new Map<string, string>();

/** Map of pageId -> authorId (last user to edit, for version attribution) */
const lastAuthors = new Map<string, string>();

/**
 * Map of pageId -> the external version the live room loaded, when it opened while a change was
 * pending (it then descends from that change); null when it opened with nothing pending.
 */
const loadedExternalVersions = new Map<string, string | null>();

/** Map of pageId -> the save in progress, so saves for a page run one after another */
const saveChains = new Map<string, Promise<SaveOutcome>>();

export type SaveOutcome = 'saved' | 'skipped' | 'failed';

/**
 * Set the author who should be credited for the next auto-save.
 * @param pageId
 * @param userId
 */
export function setLastAuthor(pageId: string, userId: string): void {
  lastAuthors.set(pageId, userId);
}

/**
 * The external version the page's live room descends from: set when the room opened while a
 * change was pending, null when it opened before any change (or after a merge).
 * @param pageId
 */
export function getLoadedExternalVersion(pageId: string): string | null {
  return loadedExternalVersions.get(pageId) ?? null;
}

/**
 * Load wiki page content into a Yjs doc if the doc's XML fragment is empty.
 * Called when a new room is created for a page.
 *
 * A pending change with no unmerged draft from a session opened before it has nothing left to
 * merge: it is cleared here, with the page row locked, so this session saves to Page.body again.
 * A pending change that does have such a draft stays, and the room remembers it descends from it.
 * @param pageId
 * @param doc
 */
export async function loadPageIntoDoc(pageId: string, doc: Y.Doc): Promise<void> {
  const loaded = await prisma.$transaction(async (tx) => {
    await lockPage(tx, pageId);
    const page = await tx.page.findUnique({ where: { id: pageId } });
    if (!page) return null;
    let pending = await tx.pendingPageChange.findUnique({ where: { pageId } });
    if (pending && !pending.draftVersionId) {
      await tx.pendingPageChange.delete({ where: { pageId } });
      pending = null;
    }
    return { body: page.body, externalVersionId: pending?.externalVersionId ?? null };
  });

  if (!loaded) return;

  // Only populate if the doc is empty (no prior state)
  const fragment = doc.getXmlFragment('default');
  if (fragment.length === 0 && loaded.body) {
    markdownToYFragment(loaded.body, fragment);
  }
  loadedSnapshots.set(pageId, normalizeMarkdown(loaded.body));
  loadedExternalVersions.set(pageId, loaded.externalVersionId);
}

/**
 * Record that the live room now holds the merged Markdown, which is also Page.body, with nothing
 * pending. Call before replacing the room's content, so no save mistakes the swap for an edit.
 * @param pageId
 * @param markdown
 */
export function markRoomMerged(pageId: string, markdown: string): void {
  loadedSnapshots.set(pageId, markdown);
  loadedExternalVersions.set(pageId, null);
}

/**
 * Persist the Yjs doc content back to the wiki page in the database.
 *
 * Normally this writes Page.body plus an EDIT version, as it also does for a room that descends
 * from the pending change (its edits build on Page.body). A room opened before the pending
 * change must not overwrite it: its state is kept as a SESSION_DRAFT version, and when that room
 * opened with nothing pending, the draft is recorded on the pending row as the unmerged work.
 * @param pageId
 * @param doc
 */
async function persistDoc(pageId: string, doc: Y.Doc): Promise<SaveOutcome> {
  const authorId = lastAuthors.get(pageId);
  if (!authorId) return 'skipped';

  try {
    const saved = await prisma.$transaction(async (tx) => {
      // Lock first, then check against the fresh rows. The doc is read after the lock too, so a
      // save that waited for a merge sees the merged content.
      await lockPage(tx, pageId);
      const body = yFragmentToMarkdown(doc.getXmlFragment('default'));
      const page = await tx.page.findUnique({ where: { id: pageId } });
      if (!page) return null;

      const pending = await tx.pendingPageChange.findUnique({ where: { pageId } });
      const loadedFrom = getLoadedExternalVersion(pageId);
      if (pending && pending.externalVersionId !== loadedFrom) {
        // Page.body is a change this session has not seen: compare only with what this session
        // last loaded or saved
        if (loadedSnapshots.get(pageId) === body) return null;
        const draft = await createPageVersion(tx, {
          pageId: page.id,
          title: page.title,
          body,
          authorId,
          kind: 'SESSION_DRAFT',
        });
        if (loadedFrom === null) {
          await tx.pendingPageChange.update({
            where: { pageId },
            data: { draftVersionId: draft.id },
          });
        }
        return body;
      }

      // Skip if content hasn't changed, or is still exactly what was loaded into the doc
      if (page.body === body || loadedSnapshots.get(pageId) === body) return null;

      await tx.page.update({ where: { id: page.id }, data: { body } });
      await createPageVersion(tx, {
        pageId: page.id,
        title: page.title,
        body,
        authorId,
        kind: 'EDIT',
      });
      return body;
    });
    if (saved === null) return 'skipped';
    // The skip above now means "unchanged since the last write", so a revert is still saved
    loadedSnapshots.set(pageId, saved);
    return 'saved';
  } catch (err) {
    logger.error('Failed to save page', { pageId }, err as Error);
    return 'failed';
  }
}

/**
 * Run a save after any save already in progress for the page.
 * @param pageId
 * @param doc
 */
function queueSave(pageId: string, doc: Y.Doc): Promise<SaveOutcome> {
  const previous = saveChains.get(pageId) ?? Promise.resolve<SaveOutcome>('skipped');
  const next = previous.then(() => persistDoc(pageId, doc));
  saveChains.set(pageId, next);
  void next.then(() => {
    if (saveChains.get(pageId) === next) saveChains.delete(pageId);
  });
  return next;
}

/**
 * Schedule a debounced save for a page's Yjs doc.
 * @param pageId
 * @param doc
 */
export function scheduleSave(pageId: string, doc: Y.Doc): void {
  const existing = saveTimers.get(pageId);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(() => {
    saveTimers.delete(pageId);
    void queueSave(pageId, doc);
  }, SAVE_DEBOUNCE_MS);

  saveTimers.set(pageId, timer);
}

/**
 * Drop a scheduled save without running it.
 * @param pageId
 */
export function cancelScheduledSave(pageId: string): void {
  const existing = saveTimers.get(pageId);
  if (existing) clearTimeout(existing);
  saveTimers.delete(pageId);
}

/**
 * Force an immediate save (used when all users disconnect from a room). Waits for a save that
 * is already running.
 * @param pageId
 * @param doc
 */
export async function forceSave(pageId: string, doc: Y.Doc): Promise<SaveOutcome> {
  cancelScheduledSave(pageId);
  return queueSave(pageId, doc);
}

/**
 * After the last session left: a pending change with no unmerged draft from a session opened
 * before it has nothing left to merge, so it is cleared and later edits go to Page.body again.
 * @param pageId
 */
export async function settlePendingAfterSession(pageId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await lockPage(tx, pageId);
    const pending = await tx.pendingPageChange.findUnique({ where: { pageId } });
    if (pending && !pending.draftVersionId) {
      await tx.pendingPageChange.delete({ where: { pageId } });
    }
  });
}

/**
 * Clean up author tracking for a page.
 * @param pageId
 */
export function clearAuthor(pageId: string): void {
  lastAuthors.delete(pageId);
  loadedSnapshots.delete(pageId);
  loadedExternalVersions.delete(pageId);
}
