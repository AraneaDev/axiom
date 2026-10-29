/**
 * Yjs persistence layer backed by Prisma/PostgreSQL.
 * Loads wiki page body into Yjs docs on first access,
 * and debounce-saves merged content back to the DB.
 */

import * as Y from 'yjs';

import { prisma } from '../config/database';
import { logger } from '../utils/logger';

const SAVE_DEBOUNCE_MS = 5_000;

/** Map of pageId -> debounce timer */
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Map of pageId -> serialization of the doc as loaded, so sessions without edits do not persist */
const loadedSnapshots = new Map<string, string>();

/** Map of pageId -> authorId (last user to edit, for version attribution) */
const lastAuthors = new Map<string, string>();

/**
 * Set the author who should be credited for the next auto-save.
 * @param pageId
 * @param userId
 */
export function setLastAuthor(pageId: string, userId: string): void {
  lastAuthors.set(pageId, userId);
}

/**
 * Load wiki page content into a Yjs doc if the doc's XML fragment is empty.
 * Called when a new room is created for a page.
 * @param pageId
 * @param doc
 */
export async function loadPageIntoDoc(pageId: string, doc: Y.Doc): Promise<void> {
  const page = await prisma.page.findUnique({
    where: { id: pageId },
  });

  if (!page) return;

  // Only populate if the doc is empty (no prior state)
  const xmlFragment = doc.getXmlFragment('default');
  if (xmlFragment.length === 0 && page.body) {
    // Insert the body as initial content.
    // TipTap collaboration uses the 'default' XML fragment, whose children must be
    // elements (a bare text node at the top level cannot be rendered by y-tiptap and
    // crashes the editor of the next client that connects), so wrap the text in a paragraph.
    doc.transact(() => {
      const paragraph = new Y.XmlElement('paragraph');
      paragraph.insert(0, [new Y.XmlText(page.body)]);
      xmlFragment.insert(0, [paragraph]);
    });
  }
  loadedSnapshots.set(pageId, xmlFragment.toJSON());
}

/**
 * Persist the Yjs doc content back to the wiki page in the database.
 * Creates a new page version for history tracking.
 * @param pageId
 * @param doc
 */
async function persistDoc(pageId: string, doc: Y.Doc): Promise<void> {
  const xmlFragment = doc.getXmlFragment('default');
  const body = xmlFragment.toJSON();

  const authorId = lastAuthors.get(pageId);
  if (!authorId) return;

  try {
    const page = await prisma.page.findUnique({
      where: { id: pageId },
      include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
    });
    if (!page) return;

    // Skip if content hasn't changed, or is still exactly what was loaded into the doc
    if (page.body === body || loadedSnapshots.get(pageId) === body) return;

    const nextVersion = (page.versions[0]?.version ?? 0) + 1;

    await prisma.page.update({
      where: { id: page.id },
      data: {
        body,
        versions: {
          create: {
            version: nextVersion,
            title: page.title,
            body,
            authorId,
          },
        },
      },
    });
    // The skip above now means "unchanged since the last write", so a revert is still saved
    loadedSnapshots.set(pageId, body);
  } catch (err) {
    logger.error('Failed to save page', { pageId }, err as Error);
  }
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
    void persistDoc(pageId, doc);
  }, SAVE_DEBOUNCE_MS);

  saveTimers.set(pageId, timer);
}

/**
 * Force an immediate save (used when all users disconnect from a room).
 * @param pageId
 * @param doc
 */
export async function forceSave(pageId: string, doc: Y.Doc): Promise<void> {
  const existing = saveTimers.get(pageId);
  if (existing) {
    clearTimeout(existing);
    saveTimers.delete(pageId);
  }

  await persistDoc(pageId, doc);
}

/**
 * Clean up author tracking for a page.
 * @param pageId
 */
export function clearAuthor(pageId: string): void {
  lastAuthors.delete(pageId);
  loadedSnapshots.delete(pageId);
}
