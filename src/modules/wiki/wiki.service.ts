import * as Diff from 'diff';

import { prisma } from '../../config/database';
import { cacheable, cacheInvalidate } from '../../config/redis';
import { normalizeMarkdown } from '../../lib/editor-core';
import { AppError } from '../../middleware/errorHandler';
import { revokeLiveAccess } from '../../realtime/access-revocation';
import { flushRoom } from '../../realtime/collaboration';
import { checkUnique } from '../../utils/check-unique';
import { ERR } from '../../utils/error-messages';
import { findOrThrow } from '../../utils/find-or-throw';
import { USER_BASIC_SELECT, TEAM_ORG_INCLUDE } from '../../utils/prisma-selects';
import { logActivity } from '../activity/activity.service';

import { applyMerge, getPendingMerge } from './page-merge';
import { createPageVersion, restoreDescription } from './page-versions';
import { writePageBody } from './page-writes';
import { canAccessSpace } from './space-permissions.service';
import { broadcastWikiUpdated, isViewRestricted } from './wiki-broadcast';
import { syncMentionLinks, extractIssueIdsFromContent } from './wiki-issue-links.service';
import { canViewPage, canEditPage, hiddenPageIds } from './wiki-permissions.service';
import { seedBuiltInTemplates } from './wiki-templates.service';

/**
 * Create a new wiki space within a team.
 * @param teamId - The team to create the space in
 * @param data - Space creation data including name, slug, and optional description
 * @param data.name
 * @param data.slug
 * @param data.description
 * @returns The created wiki space record
 * @throws {AppError} 409 if wiki space slug already taken
 */
export async function createSpace(
  teamId: string,
  data: { name: string; slug: string; description?: string },
) {
  await checkUnique('wikiSpace', { teamId, slug: data.slug }, 'Wiki space slug already taken');

  const space = await prisma.wikiSpace.create({
    data: { teamId, ...data },
  });

  // Seed built-in page blueprints into new spaces
  await seedBuiltInTemplates(space.id);

  return space;
}

/**
 * Retrieve a wiki space by ID, including root pages and their children.
 * @param spaceId - The wiki space ID
 * @param userId
 * @returns The wiki space with nested page tree
 * @throws {AppError} 404 if wiki space not found
 */
export async function getSpace(spaceId: string, userId?: string) {
  const space = await findOrThrow(
    prisma.wikiSpace.findUnique({
      where: { id: spaceId },
      include: {
        pages: {
          where: { parentId: null },
          include: { children: { select: { id: true, title: true, slug: true } } },
          orderBy: { position: 'asc' },
        },
      },
    }),
    'Wiki space not found',
  );
  if (!userId) return space;
  // Leave out pages a VIEW restriction hides from this user
  const hidden = await hiddenPageIds(userId, spaceId);
  if (hidden.size === 0) return space;
  return {
    ...space,
    pages: space.pages
      .filter((p) => !hidden.has(p.id))
      .map((p) => ({ ...p, children: p.children.filter((c) => !hidden.has(c.id)) })),
  };
}

/**
 * List all wiki spaces for a team with page counts.
 * @param teamId - The team to list wiki spaces for
 * @param includeArchived - Whether to include archived spaces (default: false)
 * @param userId
 * @returns List of wiki spaces with page counts
 */
export async function listSpaces(teamId: string, includeArchived = false, userId?: string) {
  const spaces = await prisma.wikiSpace.findMany({
    where: { teamId, ...(includeArchived ? {} : { isArchived: false }) },
    include: { _count: { select: { pages: true } } },
    orderBy: { name: 'asc' },
  });
  if (!userId) return spaces;
  // Spaces whose own permissions leave the user out are not listed
  const allowed = await Promise.all(spaces.map((sp) => canAccessSpace(sp.id, userId, 'VIEW')));
  return spaces.filter((_, i) => allowed[i]);
}

/**
 * Update wiki space properties (e.g., archive/unarchive).
 * @param spaceId - The wiki space ID
 * @param data - Update payload
 * @param data.isArchived - Whether to archive or unarchive
 * @returns The updated wiki space record
 * @throws {AppError} 404 if wiki space not found
 */
export async function updateSpace(spaceId: string, data: { isArchived?: boolean }) {
  const space = await findOrThrow(
    prisma.wikiSpace.findUnique({ where: { id: spaceId } }),
    'Wiki space not found',
  );

  return prisma.wikiSpace.update({
    where: { id: space.id },
    data,
  });
}

/**
 * Require EDIT access to a wiki space, the check the REST routes make in middleware. The page
 * write functions make it themselves, so MCP and every other caller get it too.
 * @param spaceId - The wiki space
 * @param userId - The user writing
 * @throws {AppError} 403 when the user may not edit the space
 */
async function requireSpaceEdit(spaceId: string, userId: string): Promise<void> {
  if (!(await canAccessSpace(spaceId, userId, 'EDIT'))) {
    throw new AppError(403, 'You do not have permission to edit this space');
  }
}

/**
 * A page's parent must be a page in the same space that the author may edit: otherwise a
 * page could be hung under another org's page, or under one hidden from the author.
 * @param spaceId - The space the page lives in
 * @param parentId - The proposed parent; null or undefined means top level
 * @param userId - The author
 * @throws {AppError} 400 for a parent outside the space, 403 for one the author can't edit
 */
async function assertParentWritable(
  spaceId: string,
  parentId: string | null | undefined,
  userId: string,
): Promise<void> {
  if (!parentId) return;
  const parent = await prisma.page.findUnique({
    where: { id: parentId },
    select: { spaceId: true },
  });
  if (!parent || parent.spaceId !== spaceId) {
    throw new AppError(400, 'The parent page must be in the same space');
  }
  if (!(await canEditPage(userId, parentId))) {
    throw new AppError(403, 'You do not have permission to edit the parent page');
  }
}

/**
 * Create a new wiki page in a space, with an initial version record.
 * @param spaceId - The wiki space to create the page in
 * @param authorId - The user creating the page
 * @param data - Page creation data including title, slug, body, optional parentId and isDraft
 * @param data.title
 * @param data.slug
 * @param data.body
 * @param data.parentId
 * @param data.isDraft
 * @returns The created page with version history
 * @throws {AppError} 403 without EDIT access to the space, 409 if the slug is taken in the space
 */
export async function createPage(
  spaceId: string,
  authorId: string,
  data: {
    title: string;
    slug: string;
    body?: string;
    parentId?: string;
    isDraft?: boolean;
  },
) {
  await requireSpaceEdit(spaceId, authorId);
  await assertParentWritable(spaceId, data.parentId, authorId);
  await checkUnique('page', { spaceId, slug: data.slug }, 'Page slug already taken in this space');
  const body = normalizeMarkdown(data.body ?? '');

  // Get next position
  const lastPage = await prisma.page.findFirst({
    where: { spaceId, parentId: data.parentId ?? null },
    orderBy: { position: 'desc' },
    select: { position: true },
  });

  const page = await prisma.$transaction(async (tx) => {
    const created = await tx.page.create({
      data: {
        spaceId,
        title: data.title,
        slug: data.slug,
        body,
        parentId: data.parentId,
        isDraft: data.isDraft ?? false,
        position: (lastPage?.position ?? 0) + 1,
      },
    });
    const version = await createPageVersion(tx, {
      pageId: created.id,
      title: data.title,
      body,
      authorId,
      kind: 'EDIT',
    });
    return { ...created, versions: [version] };
  });

  await cacheInvalidate(`wiki:tree:${spaceId}`);
  await logActivity('wiki_page', page.id, 'created', authorId, { title: data.title });

  if (body) {
    const issueIds = await extractIssueIdsFromContent(body, page.id, authorId);
    await syncMentionLinks(page.id, issueIds, authorId);
  }

  await broadcastWikiUpdated(spaceId, page.id);

  return page;
}

/**
 * Retrieve a wiki page by space and slug, including children and latest version.
 * @param spaceId - The wiki space ID
 * @param pageSlug - The page slug within the space
 * @param userId - Optional user ID for permission checking
 * @returns The page with children and latest version with author, plus canEdit when a user is given
 * @throws {AppError} 404 if page not found
 * @throws {AppError} 403 if user lacks view permission
 */
export async function getPage(spaceId: string, pageSlug: string, userId?: string) {
  const page = await findOrThrow(
    prisma.page.findUnique({
      where: { spaceId_slug: { spaceId, slug: pageSlug } },
      include: {
        space: { include: TEAM_ORG_INCLUDE },
        children: {
          select: { id: true, title: true, slug: true, position: true },
          orderBy: { position: 'asc' },
        },
        versions: {
          orderBy: { version: 'desc' },
          take: 1,
          include: { author: { select: USER_BASIC_SELECT } },
        },
        restrictions: {
          include: { user: { select: USER_BASIC_SELECT } },
        },
      },
    }),
    ERR.PAGE_NOT_FOUND,
  );

  if (userId) {
    const allowed = await canViewPage(userId, page.id);
    if (!allowed) throw new AppError(403, 'You do not have permission to view this page');
    // The same rule as the collaboration socket: space EDIT access and the page's restrictions
    const [spaceEdit, pageEdit, hidden] = await Promise.all([
      canAccessSpace(page.spaceId, userId, 'EDIT'),
      canEditPage(userId, page.id),
      hiddenPageIds(userId, page.spaceId),
    ]);
    // Child links leave out pages a VIEW restriction hides from this user
    const children = page.children.filter((c) => !hidden.has(c.id));
    return { ...page, children, canEdit: spaceEdit && pageEdit };
  }

  return page;
}

/**
 * Update a wiki page's content or metadata, creating a new version record.
 * @param spaceId - The wiki space ID
 * @param pageSlug - The page slug within the space
 * @param authorId - The user performing the update
 * @param data - Partial update data for title, body, parentId, isDraft, or changeDescription
 * @param data.title
 * @param data.body
 * @param data.parentId
 * @param data.isDraft
 * @param data.changeDescription
 * @param opts - Write source; defaults to the API. The version is an EDIT, or EXTERNAL when a live
 *   or ended session has to merge it
 * @param opts.source
 * @returns The updated page with latest version and whether the body change awaits a merge
 * @throws {AppError} 404 if page not found, 403 without EDIT access to the space or the page
 */
export async function updatePage(
  spaceId: string,
  pageSlug: string,
  authorId: string,
  data: {
    title?: string;
    body?: string;
    parentId?: string | null;
    isDraft?: boolean;
    changeDescription?: string;
  },
  opts: { source?: 'api' | 'mcp' } = {},
) {
  const page = await findOrThrow(
    prisma.page.findUnique({
      where: { spaceId_slug: { spaceId, slug: pageSlug } },
      include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
    }),
    ERR.PAGE_NOT_FOUND,
  );

  await requireSpaceEdit(spaceId, authorId);
  const editAllowed = await canEditPage(authorId, page.id);
  if (!editAllowed) throw new AppError(403, 'You do not have permission to edit this page');
  await assertNoParentCycle(page.id, data.parentId);
  await assertParentWritable(spaceId, data.parentId, authorId);

  const written = await writePageBody({
    pageId: page.id,
    authorId,
    title: data.title,
    body: data.body,
    parentId: data.parentId,
    isDraft: data.isDraft,
    changeDescription: data.changeDescription,
    kind: 'EDIT',
    source: opts.source ?? 'api',
  });

  // The latest version is the real latest one: a change that is not versioned (for example only
  // changeDescription) leaves it untouched rather than pretending a new version exists.
  const updated = await prisma.page.findUniqueOrThrow({
    where: { id: page.id },
    include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
  });

  await logActivity('wiki_page', page.id, 'updated', authorId, { title: updated.title });

  return {
    ...updated,
    pendingMerge: written.pendingMerge,
    // The change the open session will merge; Page.body already holds it
    ...(written.externalVersionId ? { externalVersionId: written.externalVersionId } : {}),
  };
}

/**
 * Save the live collaboration room of a page, so the stored body matches the editor.
 * @param spaceId - The wiki space ID
 * @param pageSlug - The page slug within the space
 * @param userId - The user asking for the flush
 * @param changeDescription - Attached to the version the save creates; with nothing to save, a
 *   version of the unchanged page carries it
 * @returns Whether a live room was saved
 * @throws {AppError} 404 if page not found, 403 if the user may not edit it
 */
export async function flushPageSession(
  spaceId: string,
  pageSlug: string,
  userId: string,
  changeDescription?: string,
) {
  const page = await findOrThrow(
    prisma.page.findUnique({ where: { spaceId_slug: { spaceId, slug: pageSlug } } }),
    ERR.PAGE_NOT_FOUND,
  );
  if (!(await canEditPage(userId, page.id))) {
    throw new AppError(403, 'You do not have permission to edit this page');
  }
  return { flushed: await flushRoom(page.id, { authorId: userId, changeDescription }) };
}

/**
 * Resolve a page by slug and require edit permission on it.
 * @param spaceId - The wiki space ID
 * @param pageSlug - The page slug within the space
 * @param userId - The user
 * @returns The page id
 * @throws {AppError} 404 if page not found, 403 if the user may not edit it
 */
async function editablePageId(spaceId: string, pageSlug: string, userId: string) {
  const page = await findOrThrow(
    prisma.page.findUnique({
      where: { spaceId_slug: { spaceId, slug: pageSlug } },
      select: { id: true },
    }),
    ERR.PAGE_NOT_FOUND,
  );
  if (!(await canEditPage(userId, page.id))) {
    throw new AppError(403, 'You do not have permission to edit this page');
  }
  return page.id;
}

/**
 * The base, theirs and ours texts for merging a page's pending external change.
 * @param spaceId - The wiki space ID
 * @param pageSlug - The page slug within the space
 * @param userId - The user who will merge
 * @returns The merge input, or null when nothing is pending
 */
export async function getPagePendingMerge(spaceId: string, pageSlug: string, userId: string) {
  return getPendingMerge(await editablePageId(spaceId, pageSlug, userId), userId);
}

/**
 * Apply a merged body for a page's pending external change.
 * @param spaceId - The wiki space ID
 * @param pageSlug - The page slug within the space
 * @param userId - The user merging
 * @param data - The external version merged against and the merged Markdown
 * @param data.externalVersionId
 * @param data.markdown
 * @param data.ours - The live session text the merge was computed against
 * @throws {AppError} 409 when the pending change is no longer the one merged against, another
 *   merge runs, or later session edits overlap the merge
 */
export async function applyPageMerge(
  spaceId: string,
  pageSlug: string,
  userId: string,
  data: { externalVersionId: string; markdown: string; ours: string },
) {
  await applyMerge(await editablePageId(spaceId, pageSlug, userId), userId, data);
}

/**
 * Delete a wiki page by space and slug.
 * @param spaceId - The wiki space ID
 * @param pageSlug - The page slug within the space
 * @param userId - Optional user ID for activity logging
 * @throws {AppError} 404 if page not found
 */
export async function deletePage(spaceId: string, pageSlug: string, userId?: string) {
  const page = await findOrThrow(
    prisma.page.findUnique({
      where: { spaceId_slug: { spaceId, slug: pageSlug } },
    }),
    ERR.PAGE_NOT_FOUND,
  );

  if (userId) {
    const editAllowed = await canEditPage(userId, page.id);
    if (!editAllowed) throw new AppError(403, 'You do not have permission to delete this page');
  }

  // Its restrictions are deleted with it: decide what the space may be told first
  const restricted = await isViewRestricted(page.id);
  await prisma.page.delete({ where: { id: page.id } });
  await cacheInvalidate(`wiki:tree:${spaceId}`);
  if (userId) {
    await logActivity('wiki_page', page.id, 'deleted', userId, { title: page.title });
  }

  await broadcastWikiUpdated(spaceId, page.id, restricted);
}

/**
 * Get the version history of a wiki page, ordered newest first.
 * @param spaceId - The wiki space ID
 * @param pageSlug - The page slug within the space
 * @returns List of page versions with author details
 * @throws {AppError} 404 if page not found
 */
export async function getPageHistory(spaceId: string, pageSlug: string) {
  const page = await findOrThrow(
    prisma.page.findUnique({
      where: { spaceId_slug: { spaceId, slug: pageSlug } },
      include: {
        space: { include: TEAM_ORG_INCLUDE },
        versions: {
          orderBy: { version: 'desc' },
          include: { author: { select: USER_BASIC_SELECT } },
        },
      },
    }),
    ERR.PAGE_NOT_FOUND,
  );
  return page.versions;
}

/**
 * Build a hierarchical tree of all pages in a wiki space.
 * @param spaceId - The wiki space ID
 * @returns Nested tree of pages with id, title, slug, and children
 */
export async function getPageTree(spaceId: string) {
  return cacheable(`wiki:tree:${spaceId}`, 120, async () => {
    const pages = await prisma.page.findMany({
      where: { spaceId },
      select: { id: true, title: true, slug: true, parentId: true, position: true, isDraft: true },
      orderBy: { position: 'asc' },
    });

    type PageNode = (typeof pages)[number] & { children: PageNode[] };

    // Build tree
    const map = new Map<string | null, typeof pages>();
    for (const page of pages) {
      const parentKey = page.parentId ?? null;
      if (!map.has(parentKey)) map.set(parentKey, []);
      map.get(parentKey)!.push(page);
    }

    function buildTree(parentId: string | null): PageNode[] {
      const children = map.get(parentId) ?? [];
      return children.map((p: (typeof children)[number]) => ({ ...p, children: buildTree(p.id) }));
    }

    return buildTree(null);
  }); // end cacheable
}

// ─── Version Comparison & Restore ────────────────────────────

/**
 * Compare two page versions and return a structured diff.
 * @param spaceId - The wiki space ID
 * @param pageSlug - The page slug within the space
 * @param fromVersion - The earlier version number
 * @param toVersion - The later version number
 * @returns Both versions with structured diff changes
 * @throws {AppError} 404 if page or either version not found
 * @throws {AppError} 400 if version numbers are invalid
 */
export async function diffVersions(
  spaceId: string,
  pageSlug: string,
  fromVersion: number,
  toVersion: number,
) {
  if (fromVersion < 1 || toVersion < 1 || fromVersion === toVersion) {
    throw new AppError(400, 'Invalid version numbers for comparison');
  }

  const page = await findOrThrow(
    prisma.page.findUnique({
      where: { spaceId_slug: { spaceId, slug: pageSlug } },
    }),
    ERR.PAGE_NOT_FOUND,
  );

  const [fromVer, toVer] = await Promise.all([
    findOrThrow(
      prisma.pageVersion.findUnique({
        where: { pageId_version: { pageId: page.id, version: fromVersion } },
        include: { author: { select: USER_BASIC_SELECT } },
      }),
      `Version ${fromVersion} not found`,
    ),
    findOrThrow(
      prisma.pageVersion.findUnique({
        where: { pageId_version: { pageId: page.id, version: toVersion } },
        include: { author: { select: USER_BASIC_SELECT } },
      }),
      `Version ${toVersion} not found`,
    ),
  ]);

  const changes = Diff.diffLines(fromVer.body, toVer.body);

  return {
    from: {
      version: fromVer.version,
      title: fromVer.title,
      body: fromVer.body,
      author: fromVer.author,
      changeDescription: fromVer.changeDescription,
      kind: fromVer.kind,
      createdAt: fromVer.createdAt,
    },
    to: {
      version: toVer.version,
      title: toVer.title,
      body: toVer.body,
      author: toVer.author,
      changeDescription: toVer.changeDescription,
      kind: toVer.kind,
      createdAt: toVer.createdAt,
    },
    changes: changes.map((c) => ({
      value: c.value,
      added: c.added ?? false,
      removed: c.removed ?? false,
    })),
  };
}

/**
 * Restore a wiki page to a previous version by creating a new version with that content.
 * @param spaceId - The wiki space ID
 * @param pageSlug - The page slug within the space
 * @param targetVersion - The version number to restore to
 * @param userId - The user performing the restore
 * @returns The updated page with the new version
 * @throws {AppError} 404 if page or target version not found
 */
export async function restoreVersion(
  spaceId: string,
  pageSlug: string,
  targetVersion: number,
  userId: string,
) {
  const page = await findOrThrow(
    prisma.page.findUnique({
      where: { spaceId_slug: { spaceId, slug: pageSlug } },
    }),
    ERR.PAGE_NOT_FOUND,
  );

  const target = await findOrThrow(
    prisma.pageVersion.findUnique({
      where: { pageId_version: { pageId: page.id, version: targetVersion } },
    }),
    `Version ${targetVersion} not found`,
  );

  const written = await writePageBody({
    pageId: page.id,
    authorId: userId,
    title: target.title,
    body: target.body,
    changeDescription: restoreDescription(targetVersion),
    kind: 'RESTORE',
    source: 'restore',
  });
  const updated = await prisma.page.findUniqueOrThrow({
    where: { id: page.id },
    include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
  });

  await logActivity('wiki_page', page.id, 'updated', userId, {
    title: updated.title,
    restoredToVersion: targetVersion,
  });

  return { ...updated, pendingMerge: written.pendingMerge };
}

// ─── Re-exports from sub-services ───────────────────────────
export {
  createTemplate,
  listTemplates,
  getTemplate,
  deleteTemplate,
} from './wiki-templates.service';
export {
  addPageComment,
  listPageComments,
  updatePageComment,
  resolveComment,
  deletePageComment,
} from './wiki-comments.service';
export {
  listPageLabels,
  addLabel,
  removeLabel,
  listLabels,
  searchPagesByLabel,
} from './wiki-labels.service';

// ─── Page Move / Copy ───────────────────────────────────────

/**
 * Move a wiki page to a different space or parent, checking slug uniqueness and circular references.
 * @param pageId - The page to move
 * @param targetSpaceId - Optional target wiki space ID (defaults to current space)
 * @param targetParentId - Optional new parent page ID, or null to make root-level
 * @param actorId
 * @returns The updated page record
 * @throws {AppError} 404 if page not found
 * @throws {AppError} 409 if page slug already taken in target space
 * @throws {AppError} 400 if attempting to set page as its own parent
 */
export async function movePage(
  pageId: string,
  targetSpaceId?: string,
  targetParentId?: string | null,
  actorId?: string,
) {
  const page = await findOrThrow(
    prisma.page.findUnique({ where: { id: pageId } }),
    ERR.PAGE_NOT_FOUND,
  );

  const newSpaceId = targetSpaceId ?? page.spaceId;
  const changesSpace = newSpaceId !== page.spaceId;
  await assertNoParentCycle(pageId, targetParentId);

  // A page moves with its subtree: every slug in it must be free in the target space
  const descendants = changesSpace ? await getDescendantIds(pageId) : [];
  // ... and the mover must be able to edit every page in it: a page they can't see or edit
  // must not be carried somewhere else by someone else
  if (changesSpace && actorId && descendants.length > 0) {
    const editable = await Promise.all(descendants.map((id) => canEditPage(actorId, id)));
    const blocked = editable.filter((ok) => !ok).length;
    if (blocked > 0) {
      throw new AppError(
        403,
        `You can't move this page: ${blocked} page${blocked === 1 ? '' : 's'} under it ${blocked === 1 ? 'is' : 'are'} hidden from you or not editable by you`,
      );
    }
  }
  if (changesSpace) {
    const subtree = await prisma.page.findMany({
      where: { id: { in: [pageId, ...descendants] } },
      select: { slug: true },
    });
    const taken = await prisma.page.count({
      where: { spaceId: newSpaceId, slug: { in: subtree.map((p) => p.slug) } },
    });
    if (taken > 0) throw new AppError(409, 'Page slug already taken in target space');
  }

  // In another space the old parent no longer applies: top level unless a parent is given
  const parentId =
    targetParentId !== undefined ? targetParentId : changesSpace ? null : page.parentId;

  const moved = await prisma.$transaction(async (tx) => {
    const updated = await tx.page.update({
      where: { id: pageId },
      data: { spaceId: newSpaceId, parentId },
    });
    if (descendants.length > 0) {
      await tx.page.updateMany({
        where: { id: { in: descendants } },
        data: { spaceId: newSpaceId },
      });
    }
    return updated;
  });

  if (changesSpace) {
    await cacheInvalidate(`wiki:tree:${page.spaceId}`);
    await cacheInvalidate(`wiki:tree:${newSpaceId}`);
    // Sessions on the moved pages checked access against the old space: check again
    for (const id of [pageId, ...descendants]) void revokeLiveAccess({ pageId: id });
  }
  return moved;
}

/**
 * Copy a wiki page to the same or different space with a new slug.
 * @param pageId - The source page to copy
 * @param authorId - The user performing the copy
 * @param targetSpaceId - Optional target wiki space ID (defaults to current space)
 * @param newSlug - Optional slug for the copy (defaults to original-slug-copy)
 * @returns The newly created page copy with version history
 * @throws {AppError} 404 if page not found
 * @throws {AppError} 409 if page slug already taken in target space
 */
export async function copyPage(
  pageId: string,
  authorId: string,
  targetSpaceId?: string,
  newSlug?: string,
) {
  const page = await findOrThrow(
    prisma.page.findUnique({ where: { id: pageId } }),
    ERR.PAGE_NOT_FOUND,
  );

  const destSpaceId = targetSpaceId ?? page.spaceId;
  const destSlug = newSlug ?? `${page.slug}-copy`;

  await checkUnique(
    'page',
    { spaceId: destSpaceId, slug: destSlug },
    'Page slug already taken in target space',
  );

  const lastPage = await prisma.page.findFirst({
    where: { spaceId: destSpaceId, parentId: null },
    orderBy: { position: 'desc' },
    select: { position: true },
  });

  return prisma.$transaction(async (tx) => {
    const created = await tx.page.create({
      data: {
        spaceId: destSpaceId,
        title: `${page.title} (copy)`,
        slug: destSlug,
        body: page.body,
        position: (lastPage?.position ?? 0) + 1,
      },
    });
    const version = await createPageVersion(tx, {
      pageId: created.id,
      title: created.title,
      body: page.body,
      authorId,
      kind: 'EDIT',
    });
    return { ...created, versions: [version] };
  });
}

async function getDescendantIds(pageId: string): Promise<string[]> {
  // Breadth-first with a visited set: a cycle left by older data can't recurse forever
  const seen = new Set<string>([pageId]);
  const ids: string[] = [];
  let frontier = [pageId];
  while (frontier.length > 0) {
    const children = await prisma.page.findMany({
      where: { parentId: { in: frontier } },
      select: { id: true },
    });
    frontier = [];
    for (const child of children) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      ids.push(child.id);
      frontier.push(child.id);
    }
  }
  return ids;
}

/**
 * A page can't become its own parent or the child of one of its descendants.
 * @param pageId - The page being re-parented
 * @param parentId - The proposed parent
 * @throws {AppError} 400 for a cycle
 */
async function assertNoParentCycle(pageId: string, parentId: string | null | undefined) {
  if (!parentId) return;
  if (parentId === pageId) throw new AppError(400, 'Cannot set page as its own parent');
  if ((await getDescendantIds(pageId)).includes(parentId)) {
    throw new AppError(400, 'Cannot move a page under its own descendant');
  }
}

/**
 *
 * @param pageId
 * @param parentId
 * @param position
 */
export async function reorderPage(pageId: string, parentId: string | null, position: number) {
  const page = await prisma.page.findUnique({ where: { id: pageId }, include: { space: true } });
  if (!page) throw new AppError(404, ERR.PAGE_NOT_FOUND);

  await assertNoParentCycle(pageId, parentId);

  const oldParentId = page.parentId;

  await prisma.page.update({
    where: { id: pageId },
    data: { parentId, position },
  });

  const newSiblings = await prisma.page.findMany({
    where: { spaceId: page.spaceId, parentId, id: { not: pageId } },
    orderBy: { position: 'asc' },
    select: { id: true },
  });

  const ordered = [...newSiblings.map((s) => s.id)];
  ordered.splice(Math.min(position, ordered.length), 0, pageId);

  await Promise.all(
    ordered.map((id, idx) => prisma.page.update({ where: { id }, data: { position: idx } })),
  );

  if (oldParentId !== parentId) {
    const oldSiblings = await prisma.page.findMany({
      where: { spaceId: page.spaceId, parentId: oldParentId },
      orderBy: { position: 'asc' },
      select: { id: true },
    });
    await Promise.all(
      oldSiblings.map((s, idx) =>
        prisma.page.update({ where: { id: s.id }, data: { position: idx } }),
      ),
    );
  }

  await cacheInvalidate(`wiki:tree:${page.spaceId}`);
  await broadcastWikiUpdated(page.spaceId, pageId);

  return { success: true };
}
