/**
 * Yjs persistence layer backed by Prisma/PostgreSQL.
 * Loads wiki page body into Yjs docs on first access,
 * and debounce-saves merged content back to the DB.
 */

import type { PendingPageChange } from '@prisma/client';
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

/**
 * Map of pageId -> the Page.body the live session last loaded, wrote or merged, as stored. A
 * different Page.body at save time means someone else wrote it.
 */
const knownBodies = new Map<string, string>();

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

type PendingRecordedListener = (pageId: string, pending: PendingPageChange) => void;
let pendingRecordedListener: PendingRecordedListener | null = null;

/**
 * Be told when a save finds that someone else changed Page.body under the session and records
 * a pending change for it. The collaboration server registers here to notify the room.
 * @param fn
 */
export function onPendingRecorded(fn: PendingRecordedListener): void {
  pendingRecordedListener = fn;
}

/**
 * Whether a pending change's recorded draft is one of the two sides a merge would use, which is
 * also when a notice should name it. With a live session, only when that session opened after the
 * change (it holds the change, the draft holds the earlier session's work); with nobody editing,
 * whenever there is a draft. getPendingMerge and the room notice both decide with this.
 * @param pageId
 * @param pending
 * @param pending.externalVersionId
 * @param pending.draftVersionId
 * @param roomLive - Whether a session is open on the page
 */
export function draftIsMergeSide(
  pageId: string,
  pending: { externalVersionId: string; draftVersionId: string | null },
  roomLive: boolean,
): boolean {
  if (!pending.draftVersionId) return false;
  if (!roomLive) return true;
  return getLoadedExternalVersion(pageId) === pending.externalVersionId;
}

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
  knownBodies.set(pageId, loaded.body);
  loadedExternalVersions.set(pageId, loaded.externalVersionId);
}

/**
 * The Page.body the live session last loaded, wrote or merged: what it last had in sync with the
 * database. For a session that opened after a pending change, this is the body a newer external
 * change replaced, so it is the base for merging that newer change into the session.
 * @param pageId
 */
export function getKnownBody(pageId: string): string | undefined {
  return knownBodies.get(pageId);
}

/**
 * Record that the live room now holds the merged Markdown, which is also Page.body. Call before
 * replacing the room's content, so no save mistakes the swap for an edit.
 * @param pageId
 * @param markdown
 * @param externalVersionId - The pending change the room now descends from, when one stays
 *   pending after the merge (an earlier session's draft still to merge); null when nothing is
 */
export function markRoomMerged(
  pageId: string,
  markdown: string,
  externalVersionId: string | null = null,
): void {
  loadedSnapshots.set(pageId, markdown);
  knownBodies.set(pageId, markdown);
  loadedExternalVersions.set(pageId, externalVersionId);
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
        return { body, recorded: null, wroteBody: false };
      }

      // Skip if content hasn't changed, or is still exactly what was loaded into the doc
      const snapshot = loadedSnapshots.get(pageId);
      // The page already holds exactly the session's state: nothing to write, but it is now known
      if (page.body === body) return { body, recorded: null, wroteBody: true };
      if (snapshot === body) return null;

      // Someone else wrote Page.body since this session last loaded or saved it (for example in
      // the moment the room was closing or loading, when no live room deferred the write). Never
      // overwrite that: record it as a pending change and keep the session's work as its draft.
      const known = knownBodies.get(pageId);
      if (known !== undefined && page.body !== known) {
        const external = await tx.pageVersion.findFirst({
          where: { pageId, kind: { not: 'SESSION_DRAFT' } },
          orderBy: { version: 'desc' },
        });
        if (external) {
          const draft = await createPageVersion(tx, {
            pageId: page.id,
            title: page.title,
            body,
            authorId,
            kind: 'SESSION_DRAFT',
          });
          const recorded = pending
            ? null // a row this session descends from: keep it and its draft as they are
            : await tx.pendingPageChange.create({
                data: {
                  pageId,
                  baseBody: snapshot ?? known,
                  externalVersionId: external.id,
                  authorId: external.authorId,
                  draftVersionId: draft.id,
                },
              });
          return { body, recorded, wroteBody: false };
        }
      }

      await tx.page.update({ where: { id: page.id }, data: { body } });
      await createPageVersion(tx, {
        pageId: page.id,
        title: page.title,
        body,
        authorId,
        kind: 'EDIT',
      });
      return { body, recorded: null, wroteBody: true };
    });
    if (saved === null) return 'skipped';
    // The skip above now means "unchanged since the last write", so a revert is still saved
    loadedSnapshots.set(pageId, saved.body);
    if (saved.wroteBody) knownBodies.set(pageId, saved.body);
    if (saved.recorded) {
      // This session now predates the recorded change, and its later drafts are the work to merge
      loadedExternalVersions.set(pageId, null);
      pendingRecordedListener?.(pageId, saved.recorded);
    }
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
 * Never rejects: a failure is logged and leaves the row, which the next session's load settles.
 * @param pageId
 */
export async function settlePendingAfterSession(pageId: string): Promise<void> {
  try {
    await prisma.$transaction(async (tx) => {
      await lockPage(tx, pageId);
      const pending = await tx.pendingPageChange.findUnique({ where: { pageId } });
      if (pending && !pending.draftVersionId) {
        await tx.pendingPageChange.delete({ where: { pageId } });
      }
    });
  } catch (err) {
    logger.error('Failed to settle the pending change after the session', { pageId }, err as Error);
  }
}

/**
 * Clean up author tracking for a page.
 * @param pageId
 */
export function clearAuthor(pageId: string): void {
  lastAuthors.delete(pageId);
  loadedSnapshots.delete(pageId);
  knownBodies.delete(pageId);
  loadedExternalVersions.delete(pageId);
}
