import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { logActivity } from '../activity/activity.service';

/**
 *
 * @param teamId
 * @param data
 * @param data.name
 * @param data.slug
 * @param data.description
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
 *
 * @param spaceId
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
 *
 * @param teamId
 */
export async function listSpaces(teamId: string) {
  return prisma.wikiSpace.findMany({
    where: { teamId },
    include: { _count: { select: { pages: true } } },
    orderBy: { name: 'asc' },
  });
}

/**
 *
 * @param spaceId
 * @param authorId
 * @param data
 * @param data.title
 * @param data.slug
 * @param data.body
 * @param data.parentId
 * @param data.isDraft
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
 *
 * @param spaceId
 * @param pageSlug
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
        include: { author: { select: { id: true, username: true, displayName: true } } },
      },
    },
  });
  if (!page) throw new AppError(404, 'Page not found');
  return page;
}

/**
 *
 * @param spaceId
 * @param pageSlug
 * @param authorId
 * @param data
 * @param data.title
 * @param data.body
 * @param data.parentId
 * @param data.isDraft
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
 *
 * @param spaceId
 * @param pageSlug
 * @param userId
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
 *
 * @param spaceId
 * @param pageSlug
 */
export async function getPageHistory(spaceId: string, pageSlug: string) {
  const page = await prisma.page.findUnique({
    where: { spaceId_slug: { spaceId, slug: pageSlug } },
    include: {
      versions: {
        orderBy: { version: 'desc' },
        include: { author: { select: { id: true, username: true, displayName: true } } },
      },
    },
  });
  if (!page) throw new AppError(404, 'Page not found');
  return page.versions;
}

/**
 *
 * @param spaceId
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
 *
 * @param spaceId
 * @param data
 * @param data.name
 * @param data.body
 * @param data.description
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
 *
 * @param spaceId
 */
export async function listTemplates(spaceId: string) {
  return prisma.pageTemplate.findMany({
    where: { spaceId },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 *
 * @param id
 */
export async function getTemplate(id: string) {
  const template = await prisma.pageTemplate.findUnique({ where: { id } });
  if (!template) throw new AppError(404, 'Template not found');
  return template;
}

/**
 *
 * @param id
 */
export async function deleteTemplate(id: string) {
  const template = await prisma.pageTemplate.findUnique({ where: { id } });
  if (!template) throw new AppError(404, 'Template not found');
  await prisma.pageTemplate.delete({ where: { id } });
}

// ─── Page Comments ──────────────────────────────────────────

/**
 *
 * @param pageId
 * @param userId
 * @param body
 * @param anchorText
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
    include: { user: { select: { id: true, username: true, displayName: true } } },
  });
}

/**
 *
 * @param pageId
 */
export async function listPageComments(pageId: string) {
  return prisma.pageComment.findMany({
    where: { pageId },
    include: { user: { select: { id: true, username: true, displayName: true } } },
    orderBy: { createdAt: 'asc' },
  });
}

/**
 *
 * @param commentId
 */
export async function resolveComment(commentId: string) {
  const comment = await prisma.pageComment.findUnique({ where: { id: commentId } });
  if (!comment) throw new AppError(404, 'Comment not found');

  return prisma.pageComment.update({
    where: { id: commentId },
    data: { resolved: !comment.resolved },
    include: { user: { select: { id: true, username: true, displayName: true } } },
  });
}

/**
 *
 * @param commentId
 */
export async function deletePageComment(commentId: string) {
  const comment = await prisma.pageComment.findUnique({ where: { id: commentId } });
  if (!comment) throw new AppError(404, 'Comment not found');
  await prisma.pageComment.delete({ where: { id: commentId } });
}

// ─── Page Labels ────────────────────────────────────────────

/**
 *
 * @param pageId
 * @param label
 */
export async function addLabel(pageId: string, label: string) {
  const page = await prisma.page.findUnique({ where: { id: pageId } });
  if (!page) throw new AppError(404, 'Page not found');

  return prisma.pageLabel.create({
    data: { pageId, label },
  });
}

/**
 *
 * @param pageId
 * @param label
 */
export async function removeLabel(pageId: string, label: string) {
  const existing = await prisma.pageLabel.findUnique({
    where: { pageId_label: { pageId, label } },
  });
  if (!existing) throw new AppError(404, 'Label not found on this page');
  await prisma.pageLabel.delete({ where: { id: existing.id } });
}

/**
 *
 * @param pageId
 */
export async function listLabels(pageId: string) {
  return prisma.pageLabel.findMany({
    where: { pageId },
    orderBy: { label: 'asc' },
  });
}

/**
 *
 * @param spaceId
 * @param label
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
 *
 * @param pageId
 * @param targetSpaceId
 * @param targetParentId
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
 *
 * @param pageId
 * @param authorId
 * @param targetSpaceId
 * @param newSlug
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
