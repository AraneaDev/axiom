import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { USER_BASIC_SELECT } from '../../utils/prisma-selects';
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
  const existing = await prisma.wikiSpace.findUnique({
    where: { teamId_slug: { teamId, slug: data.slug } },
  });
  if (existing) throw new AppError(409, 'Wiki space slug already taken');

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
  const space = await prisma.wikiSpace.findUnique({
    where: { id: spaceId },
    include: {
      pages: {
        where: { parentId: null },
        include: { children: { select: { id: true, title: true, slug: true } } },
        orderBy: { position: 'asc' },
      },
    },
  });
  if (!space) throw new AppError(404, 'Wiki space not found');
  return space;
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
  const existing = await prisma.page.findUnique({
    where: { spaceId_slug: { spaceId, slug: data.slug } },
  });
  if (existing) throw new AppError(409, 'Page slug already taken in this space');

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

  await logActivity('wiki_page', page.id, 'created', authorId, { title: data.title });
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
  const page = await prisma.page.findUnique({
    where: { spaceId_slug: { spaceId, slug: pageSlug } },
    include: {
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
  });
  if (!page) throw new AppError(404, 'Page not found');
  return page;
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
  const page = await prisma.page.findUnique({
    where: { spaceId_slug: { spaceId, slug: pageSlug } },
    include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
  });
  if (!page) throw new AppError(404, 'Page not found');

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

  await logActivity('wiki_page', page.id, 'updated', authorId, { title: updated.title });
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
  const page = await prisma.page.findUnique({
    where: { spaceId_slug: { spaceId, slug: pageSlug } },
  });
  if (!page) throw new AppError(404, 'Page not found');
  await prisma.page.delete({ where: { id: page.id } });
  if (userId) {
    await logActivity('wiki_page', page.id, 'deleted', userId, { title: page.title });
  }
}

/**
 * Get the version history of a wiki page, ordered newest first.
 * @param spaceId - The wiki space ID
 * @param pageSlug - The page slug within the space
 * @returns List of page versions with author details
 * @throws {AppError} 404 if page not found
 */
export async function getPageHistory(spaceId: string, pageSlug: string) {
  const page = await prisma.page.findUnique({
    where: { spaceId_slug: { spaceId, slug: pageSlug } },
    include: {
      versions: {
        orderBy: { version: 'desc' },
        include: { author: { select: USER_BASIC_SELECT } },
      },
    },
  });
  if (!page) throw new AppError(404, 'Page not found');
  return page.versions;
}

/**
 * Build a hierarchical tree of all pages in a wiki space.
 * @param spaceId - The wiki space ID
 * @returns Nested tree of pages with id, title, slug, and children
 */
export async function getPageTree(spaceId: string) {
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
}

// ─── Templates ──────────────────────────────────────────────

/**
 * Create a page template in a wiki space.
 * @param spaceId - The wiki space ID
 * @param data - Template data including name, body, and optional description
 * @param data.name
 * @param data.body
 * @param data.description
 * @returns The created template record
 */
export async function createTemplate(
  spaceId: string,
  data: { name: string; body: string; description?: string },
) {
  return prisma.pageTemplate.create({
    data: { spaceId, ...data },
  });
}

/**
 * List all page templates in a wiki space.
 * @param spaceId - The wiki space ID
 * @returns List of template records ordered by creation date
 */
export async function listTemplates(spaceId: string) {
  return prisma.pageTemplate.findMany({
    where: { spaceId },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Retrieve a page template by ID.
 * @param id - The template ID
 * @returns The template record
 * @throws {AppError} 404 if template not found
 */
export async function getTemplate(id: string) {
  const template = await prisma.pageTemplate.findUnique({ where: { id } });
  if (!template) throw new AppError(404, 'Template not found');
  return template;
}

/**
 * Delete a page template by ID.
 * @param id - The template ID
 * @throws {AppError} 404 if template not found
 */
export async function deleteTemplate(id: string) {
  const template = await prisma.pageTemplate.findUnique({ where: { id } });
  if (!template) throw new AppError(404, 'Template not found');
  await prisma.pageTemplate.delete({ where: { id } });
}

// ─── Page Comments ──────────────────────────────────────────

/**
 * Add a comment to a wiki page, optionally anchored to specific text.
 * @param pageId - The page to comment on
 * @param userId - The user authoring the comment
 * @param body - The comment body text
 * @param anchorText - Optional text selection the comment is anchored to
 * @returns The created comment with user relation
 * @throws {AppError} 404 if page not found
 */
export async function addPageComment(
  pageId: string,
  userId: string,
  body: string,
  anchorText?: string,
) {
  const page = await prisma.page.findUnique({ where: { id: pageId } });
  if (!page) throw new AppError(404, 'Page not found');

  return prisma.pageComment.create({
    data: { pageId, userId, body, anchorText },
    include: { user: { select: USER_BASIC_SELECT } },
  });
}

/**
 * List all comments on a wiki page, ordered chronologically.
 * @param pageId - The page to list comments for
 * @returns List of comment records with user relations
 */
export async function listPageComments(pageId: string) {
  return prisma.pageComment.findMany({
    where: { pageId },
    include: { user: { select: USER_BASIC_SELECT } },
    orderBy: { createdAt: 'asc' },
  });
}

/**
 * Update a wiki page comment (only the author may edit).
 * @param commentId - The comment to update
 * @param userId - The user attempting the update
 * @param body - The new comment body text
 * @returns The updated comment with user relation
 * @throws {AppError} 404 if comment not found
 * @throws {AppError} 403 if user is not the comment author
 */
export async function updatePageComment(commentId: string, userId: string, body: string) {
  const comment = await prisma.pageComment.findUnique({ where: { id: commentId } });
  if (!comment) throw new AppError(404, 'Comment not found');
  if (comment.userId !== userId) throw new AppError(403, 'You can only edit your own comments');

  return prisma.pageComment.update({
    where: { id: commentId },
    data: { body },
    include: { user: { select: USER_BASIC_SELECT } },
  });
}

/**
 * Toggle the resolved status of a wiki page comment.
 * @param commentId - The comment to resolve/unresolve
 * @returns The updated comment with user relation
 * @throws {AppError} 404 if comment not found
 */
export async function resolveComment(commentId: string) {
  const comment = await prisma.pageComment.findUnique({ where: { id: commentId } });
  if (!comment) throw new AppError(404, 'Comment not found');

  return prisma.pageComment.update({
    where: { id: commentId },
    data: { resolved: !comment.resolved },
    include: { user: { select: USER_BASIC_SELECT } },
  });
}

/**
 * Delete a wiki page comment.
 * @param commentId - The comment to delete
 * @throws {AppError} 404 if comment not found
 */
export async function deletePageComment(commentId: string) {
  const comment = await prisma.pageComment.findUnique({ where: { id: commentId } });
  if (!comment) throw new AppError(404, 'Comment not found');
  await prisma.pageComment.delete({ where: { id: commentId } });
}

// ─── Page Labels ────────────────────────────────────────────

/**
 * Add a label to a wiki page.
 * @param pageId - The page to add the label to
 * @param label - The label text
 * @returns The created page label record
 * @throws {AppError} 404 if page not found
 */
export async function addLabel(pageId: string, label: string) {
  const page = await prisma.page.findUnique({ where: { id: pageId } });
  if (!page) throw new AppError(404, 'Page not found');

  return prisma.pageLabel.create({
    data: { pageId, label },
  });
}

/**
 * Remove a label from a wiki page.
 * @param pageId - The page to remove the label from
 * @param label - The label text to remove
 * @throws {AppError} 404 if label not found on the page
 */
export async function removeLabel(pageId: string, label: string) {
  const existing = await prisma.pageLabel.findUnique({
    where: { pageId_label: { pageId, label } },
  });
  if (!existing) throw new AppError(404, 'Label not found on this page');
  await prisma.pageLabel.delete({ where: { id: existing.id } });
}

/**
 * List all labels on a wiki page.
 * @param pageId - The page to list labels for
 * @returns List of page label records ordered alphabetically
 */
export async function listLabels(pageId: string) {
  return prisma.pageLabel.findMany({
    where: { pageId },
    orderBy: { label: 'asc' },
  });
}

/**
 * Search for pages in a wiki space by label.
 * @param spaceId - The wiki space to search in
 * @param label - The label to filter pages by
 * @returns List of matching pages with id, title, and slug
 */
export async function searchPagesByLabel(spaceId: string, label: string) {
  return prisma.page.findMany({
    where: {
      spaceId,
      pageLabels: { some: { label } },
    },
    select: { id: true, title: true, slug: true },
    orderBy: { title: 'asc' },
  });
}

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
  const page = await prisma.page.findUnique({ where: { id: pageId } });
  if (!page) throw new AppError(404, 'Page not found');

  const newSpaceId = targetSpaceId ?? page.spaceId;

  // Check slug uniqueness in target space if moving to a different space
  if (newSpaceId !== page.spaceId) {
    const existing = await prisma.page.findUnique({
      where: { spaceId_slug: { spaceId: newSpaceId, slug: page.slug } },
    });
    if (existing) throw new AppError(409, 'Page slug already taken in target space');
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
  const page = await prisma.page.findUnique({ where: { id: pageId } });
  if (!page) throw new AppError(404, 'Page not found');

  const destSpaceId = targetSpaceId ?? page.spaceId;
  const destSlug = newSlug ?? `${page.slug}-copy`;

  const existing = await prisma.page.findUnique({
    where: { spaceId_slug: { spaceId: destSpaceId, slug: destSlug } },
  });
  if (existing) throw new AppError(409, 'Page slug already taken in target space');

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
