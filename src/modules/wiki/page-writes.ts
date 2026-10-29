import type { Page, PageVersion, PendingPageChange } from '@prisma/client';

import { prisma } from '../../config/database';
import { cacheInvalidate } from '../../config/redis';
import { normalizeMarkdown } from '../../lib/editor-core';
import { broadcastToRoom } from '../../realtime/broadcast';
import { isRoomLive } from '../../realtime/collaboration';

import { createPageVersion, lockPage } from './page-versions';
import { extractIssueIdsFromContent, syncMentionLinks } from './wiki-issue-links.service';

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
  pendingMerge: boolean;
}

/** Dependencies that tests may replace; production uses the live collaboration registry. */
export interface PageWriteDeps {
  isRoomLive: (pageId: string) => boolean;
}

type ExternalChangeHook = (pageId: string, pending: PendingPageChange) => void;

const externalChangeHooks: ExternalChangeHook[] = [];

/**
 * Register a listener that is told when an external change is recorded for a page with a live
 * collaboration room. The collaboration layer registers here to notify the room.
 * @param fn - Called after the pending change is committed
 */
export function registerExternalChangeHook(fn: ExternalChangeHook): void {
  externalChangeHooks.push(fn);
}

/**
 * The single write path for page bodies outside the collaborative editor.
 *
 * Non-body fields apply immediately. A body change from anything but an editor session, while a
 * collaboration room is live for the page, is recorded as a pending change and leaves Page.body
 * alone, so the open session can merge it. Otherwise Page.body and a version are written.
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
    const bodyChanged = normalizedBody !== undefined && normalizedBody !== current.body;
    const newBody = bodyChanged ? normalizedBody : current.body;
    // A restore is a history event even when the content happens to match the head
    const versionedChange = newTitle !== current.title || bodyChanged || input.kind === 'RESTORE';
    const defer = bodyChanged && input.source !== 'editor-session' && roomLive(input.pageId);

    const page = await tx.page.update({
      where: { id: input.pageId },
      data: {
        title: newTitle,
        ...(bodyChanged && !defer ? { body: newBody } : {}),
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
    if (defer && version) {
      pending = await tx.pendingPageChange.upsert({
        where: { pageId: input.pageId },
        create: {
          pageId: input.pageId,
          baseBody: current.body,
          externalVersionId: version.id,
          authorId: input.authorId,
        },
        // baseBody stays: it is the body the open session last saw
        update: { externalVersionId: version.id, authorId: input.authorId },
      });
    }
    return { page, version, pending, bodyWritten: bodyChanged && !defer, newBody };
  });

  await cacheInvalidate(`wiki:tree:${result.page.spaceId}`);

  if (result.bodyWritten) {
    const issueIds = await extractIssueIdsFromContent(result.newBody);
    await syncMentionLinks(input.pageId, issueIds, input.authorId);
  }

  broadcastToRoom(`space:${result.page.spaceId}`, {
    type: 'wiki:updated',
    spaceId: result.page.spaceId,
    pageId: input.pageId,
  });

  if (result.pending) {
    for (const hook of externalChangeHooks) hook(input.pageId, result.pending);
  }

  return { page: result.page, version: result.version, pendingMerge: result.pending !== null };
}
