import type { Page, PageVersion, PendingPageChange } from '@prisma/client';

import { prisma } from '../../config/database';
import { cacheInvalidate } from '../../config/redis';
import { normalizeMarkdown } from '../../lib/editor-core';
import { broadcastToRoom } from '../../realtime/broadcast';
import { isRoomLive } from '../../realtime/collaboration';

import { createPageVersion, lockPage } from './page-versions';
import { extractIssueIdsFromContent, syncMentionLinks } from './wiki-issue-links.service';

/**
 * The change description of a RESTORE version.
 * @param version - The version restored
 */
export const restoreDescription = (version: number) => `Restored to version ${version}`;

/**
 * The version a RESTORE version restored, read back from its change description.
 * @param changeDescription
 */
export function restoredVersionOf(changeDescription: string | null): number | null {
  const match = /^Restored to version (\d+)$/.exec(changeDescription ?? '');
  return match ? Number(match[1]) : null;
}

export type PageWriteKind = 'EDIT' | 'EXTERNAL' | 'RESTORE';
export type PageWriteSource = 'api' | 'mcp' | 'restore' | 'editor-session';

export interface WritePageBodyInput {
  pageId: string;
  authorId: string;
  title?: string;
  body?: string;
  parentId?: string | null;
  isDraft?: boolean;
  changeDescription?: string;
  kind: PageWriteKind;
  source: PageWriteSource;
}

export interface WritePageBodyResult {
  page: Page;
  version: PageVersion | null;
  /** True while an external change waits for the live session to merge it */
  pendingMerge: boolean;
  /** The external version the session will merge, when pendingMerge is true */
  externalVersionId?: string;
}

/** Dependencies that tests may replace; production uses the live collaboration registry. */
export interface PageWriteDeps {
  isRoomLive: (pageId: string) => boolean;
}

type ExternalChangeHook = (pageId: string, pending: PendingPageChange) => void;

const externalChangeHooks: ExternalChangeHook[] = [];

/** Test-only: forget every registered hook. */
export function resetExternalChangeHooksForTest(): void {
  externalChangeHooks.length = 0;
}

/**
 * Register a listener that is told when an external change is recorded for a page with a live
 * collaboration room. The collaboration layer registers here to notify the room.
 * @param fn - Called after the pending change is committed
 */
export function registerExternalChangeHook(fn: ExternalChangeHook): void {
  if (!externalChangeHooks.includes(fn)) externalChangeHooks.push(fn);
}

/** Replaceable issue-link sync (tests); production extracts the issue ids from the body. */
export type SyncIssueLinks = (pageId: string, body: string, authorId: string) => Promise<void>;

const defaultSyncIssueLinks: SyncIssueLinks = async (pageId, body, authorId) => {
  const issueIds = await extractIssueIdsFromContent(body);
  await syncMentionLinks(pageId, issueIds, authorId);
};

/**
 * What every page write does after its transaction: invalidate the tree cache, sync issue links
 * for a body that was written, and tell the space's subscribers.
 * @param page - The written page
 * @param page.id
 * @param page.spaceId
 * @param authorId - Who wrote it
 * @param writtenBody - The body stored in Page.body, or null when the body was not written
 * @param syncIssueLinks - Link sync (tests may replace it)
 */
export async function finishPageWrite(
  page: { id: string; spaceId: string },
  authorId: string,
  writtenBody: string | null,
  syncIssueLinks: SyncIssueLinks = defaultSyncIssueLinks,
): Promise<void> {
  await cacheInvalidate(`wiki:tree:${page.spaceId}`);
  if (writtenBody !== null) await syncIssueLinks(page.id, writtenBody, authorId);
  broadcastToRoom(`space:${page.spaceId}`, {
    type: 'wiki:updated',
    spaceId: page.spaceId,
    pageId: page.id,
  });
}

/**
 * The single write path for page bodies outside the collaborative editor.
 *
 * Non-body fields apply immediately, and a body change always lands in Page.body plus a version,
 * so readers see the latest stored text. When it comes from anything but an editor session while
 * a collaboration room is live for the page, it is also recorded as a pending change: the room
 * keeps the session's text and merges the change later, against the body it replaced.
 * @param input - What to write and who is writing it
 * @param deps - Replaceable dependencies (tests)
 * @returns The page, the version created (if any) and whether a merge is pending
 */
export async function writePageBody(
  input: WritePageBodyInput,
  deps: Partial<PageWriteDeps> = {},
): Promise<WritePageBodyResult> {
  const roomLive = deps.isRoomLive ?? isRoomLive;
  const normalizedBody = input.body === undefined ? undefined : normalizeMarkdown(input.body);

  const result = await prisma.$transaction(async (tx) => {
    // Lock first, then decide on fresh data: a caller's earlier read may predate a concurrent write
    await lockPage(tx, input.pageId);
    const current = await tx.page.findUniqueOrThrow({ where: { id: input.pageId } });

    const newTitle = input.title ?? current.title;
    // A change waiting for a merge outlives its session (the draft is merged later), so a write
    // must keep the pending row pointing at the newest body even when no room is live
    const existingPending =
      input.source !== 'editor-session'
        ? await tx.pendingPageChange.findUnique({ where: { pageId: input.pageId } })
        : null;
    const deferrable =
      input.source !== 'editor-session' && (existingPending !== null || roomLive(input.pageId));
    const bodyChanged = normalizedBody !== undefined && normalizedBody !== current.body;
    const newBody = bodyChanged ? normalizedBody : current.body;
    // A restore is a history event even when the content happens to match the head
    const versionedChange = newTitle !== current.title || bodyChanged || input.kind === 'RESTORE';

    const page = await tx.page.update({
      where: { id: input.pageId },
      data: {
        title: newTitle,
        ...(bodyChanged ? { body: newBody } : {}),
        parentId: input.parentId !== undefined ? input.parentId : current.parentId,
        isDraft: input.isDraft !== undefined ? input.isDraft : current.isDraft,
      },
    });

    let version: PageVersion | null = null;
    if (versionedChange) {
      version = await createPageVersion(tx, {
        pageId: input.pageId,
        title: newTitle,
        body: newBody,
        authorId: input.authorId,
        kind: input.kind,
        changeDescription: input.changeDescription,
      });
    }

    let pending: PendingPageChange | null = null;
    let notify = false;
    if (deferrable && bodyChanged && version) {
      pending = await tx.pendingPageChange.upsert({
        where: { pageId: input.pageId },
        create: {
          pageId: input.pageId,
          baseBody: current.body,
          externalVersionId: version.id,
          authorId: input.authorId,
        },
        // baseBody stays: it is the body the open session last had in sync with the database
        update: { externalVersionId: version.id, authorId: input.authorId },
      });
      notify = true;
    } else {
      // Nothing new to merge, but a change may already be waiting: report it
      pending = existingPending;
    }
    return { page, version, pending, notify, newBody: bodyChanged ? newBody : null };
  });

  await finishPageWrite(result.page, input.authorId, result.newBody);

  if (result.pending && result.notify) {
    for (const hook of externalChangeHooks) hook(input.pageId, result.pending);
  }

  return {
    page: result.page,
    version: result.version,
    pendingMerge: result.pending !== null,
    ...(result.pending ? { externalVersionId: result.pending.externalVersionId } : {}),
  };
}
