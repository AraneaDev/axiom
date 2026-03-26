import { prisma } from '../../config/database';
import { cacheable, cacheInvalidate } from '../../config/redis';
import { AppError } from '../../middleware/errorHandler';
import { broadcastToRoom } from '../../realtime/broadcast';
import { checkUnique } from '../../utils/check-unique';
import { findOrThrow } from '../../utils/find-or-throw';
import { USER_BASIC_SELECT, TEAM_ORG_INCLUDE } from '../../utils/prisma-selects';
import { logActivity } from '../activity/activity.service';

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

  return prisma.wikiSpace.create({
    data: { teamId, ...data },
  });
}

/**
 * Retrieve a wiki space by ID, including root pages and their children.
 * @param spaceId - The wiki space ID
 * @returns The wiki space with nested page tree
 * @throws {AppError} 404 if wiki space not found
 */
export async function getSpace(spaceId: string) {
  return findOrThrow(
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
}

/**
 * List all wiki spaces for a team with page counts.
 * @param teamId - The team to list wiki spaces for
 * @returns List of wiki spaces with page counts
 */
export async function listSpaces(teamId: string) {
  return prisma.wikiSpace.findMany({
    where: { teamId },
    include: { _count: { select: { pages: true } } },
    orderBy: { name: 'asc' },
  });
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
 * @throws {AppError} 409 if page slug already taken in this space
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
  await checkUnique('page', { spaceId, slug: data.slug }, 'Page slug already taken in this space');

  // Get next position
  const lastPage = await prisma.page.findFirst({
    where: { spaceId, parentId: data.parentId ?? null },
    orderBy: { position: 'desc' },
    select: { position: true },
  });

  const page = await prisma.page.create({
    data: {
      spaceId,
      title: data.title,
      slug: data.slug,
      body: data.body ?? '',
      parentId: data.parentId,
      isDraft: data.isDraft ?? false,
      position: (lastPage?.position ?? 0) + 1,
      versions: {
        create: {
          version: 1,
          title: data.title,
          body: data.body ?? '',
          authorId,
        },
      },
    },
    include: { versions: true },
  });

  await cacheInvalidate(`wiki:tree:${spaceId}`);
  await logActivity('wiki_page', page.id, 'created', authorId, { title: data.title });

  broadcastToRoom(`space:${spaceId}`, { type: 'wiki:updated', spaceId, pageId: page.id });

  return page;
}

/**
 * Retrieve a wiki page by space and slug, including children and latest version.
 * @param spaceId - The wiki space ID
 * @param pageSlug - The page slug within the space
 * @returns The page with children and latest version with author
 * @throws {AppError} 404 if page not found
 */
export async function getPage(spaceId: string, pageSlug: string) {
  return findOrThrow(
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
      },
    }),
    'Page not found',
  );
}

/**
 * Update a wiki page's content or metadata, creating a new version record.
 * @param spaceId - The wiki space ID
 * @param pageSlug - The page slug within the space
 * @param authorId - The user performing the update
 * @param data - Partial update data for title, body, parentId, or isDraft
 * @param data.title
 * @param data.body
 * @param data.parentId
 * @param data.isDraft
 * @returns The updated page with latest version
 * @throws {AppError} 404 if page not found
 */
export async function updatePage(
  spaceId: string,
  pageSlug: string,
  authorId: string,
  data: {
    title?: string;
    body?: string;
    parentId?: string;
    isDraft?: boolean;
  },
) {
  const page = await findOrThrow(
    prisma.page.findUnique({
      where: { spaceId_slug: { spaceId, slug: pageSlug } },
      include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
    }),
    'Page not found',
  );

  const nextVersion = (page.versions[0]?.version ?? 0) + 1;

  const updated = await prisma.page.update({
    where: { id: page.id },
    data: {
      title: data.title ?? page.title,
      body: data.body ?? page.body,
      parentId: data.parentId !== undefined ? data.parentId : page.parentId,
      isDraft: data.isDraft !== undefined ? data.isDraft : page.isDraft,
      versions: {
        create: {
          version: nextVersion,
          title: data.title ?? page.title,
          body: data.body ?? page.body,
          authorId,
        },
      },
    },
    include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
  });

  await cacheInvalidate(`wiki:tree:${spaceId}`);
  await logActivity('wiki_page', page.id, 'updated', authorId, { title: updated.title });

  broadcastToRoom(`space:${spaceId}`, { type: 'wiki:updated', spaceId, pageId: page.id });

  return updated;
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
    'Page not found',
  );
  await prisma.page.delete({ where: { id: page.id } });
  await cacheInvalidate(`wiki:tree:${spaceId}`);
  if (userId) {
    await logActivity('wiki_page', page.id, 'deleted', userId, { title: page.title });
  }

  broadcastToRoom(`space:${spaceId}`, { type: 'wiki:updated', spaceId, pageId: page.id });
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
    'Page not found',
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
 * @returns The updated page record
 * @throws {AppError} 404 if page not found
 * @throws {AppError} 409 if page slug already taken in target space
 * @throws {AppError} 400 if attempting to set page as its own parent
 */
export async function movePage(
  pageId: string,
  targetSpaceId?: string,
  targetParentId?: string | null,
) {
  const page = await findOrThrow(
    prisma.page.findUnique({ where: { id: pageId } }),
    'Page not found',
  );

  const newSpaceId = targetSpaceId ?? page.spaceId;

  // Check slug uniqueness in target space if moving to a different space
  if (newSpaceId !== page.spaceId) {
    await checkUnique(
      'page',
      { spaceId: newSpaceId, slug: page.slug },
      'Page slug already taken in target space',
    );
  }

  // Prevent circular parent
  if (targetParentId === pageId) {
    throw new AppError(400, 'Cannot set page as its own parent');
  }

  return prisma.page.update({
    where: { id: pageId },
    data: {
      spaceId: newSpaceId,
      parentId: targetParentId !== undefined ? targetParentId : page.parentId,
    },
  });
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
    'Page not found',
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

  return prisma.page.create({
    data: {
      spaceId: destSpaceId,
      title: `${page.title} (copy)`,
      slug: destSlug,
      body: page.body,
      position: (lastPage?.position ?? 0) + 1,
      versions: {
        create: {
          version: 1,
          title: `${page.title} (copy)`,
          body: page.body,
          authorId,
        },
      },
    },
    include: { versions: true },
  });
}
