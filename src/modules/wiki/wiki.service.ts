import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';

export async function createSpace(teamId: string, data: { name: string; slug: string; description?: string }) {
  const existing = await prisma.wikiSpace.findUnique({
    where: { teamId_slug: { teamId, slug: data.slug } },
  });
  if (existing) throw new AppError(409, 'Wiki space slug already taken');

  return prisma.wikiSpace.create({
    data: { teamId, ...data },
  });
}

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

export async function listSpaces(teamId: string) {
  return prisma.wikiSpace.findMany({
    where: { teamId },
    include: { _count: { select: { pages: true } } },
    orderBy: { name: 'asc' },
  });
}

export async function createPage(spaceId: string, authorId: string, data: {
  title: string;
  slug: string;
  body?: string;
  parentId?: string;
  isDraft?: boolean;
}) {
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

  return page;
}

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

export async function updatePage(spaceId: string, pageSlug: string, authorId: string, data: {
  title?: string;
  body?: string;
  parentId?: string;
  isDraft?: boolean;
}) {
  const page = await prisma.page.findUnique({
    where: { spaceId_slug: { spaceId, slug: pageSlug } },
    include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
  });
  if (!page) throw new AppError(404, 'Page not found');

  const nextVersion = (page.versions[0]?.version ?? 0) + 1;

  return prisma.page.update({
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
}

export async function deletePage(spaceId: string, pageSlug: string) {
  const page = await prisma.page.findUnique({
    where: { spaceId_slug: { spaceId, slug: pageSlug } },
  });
  if (!page) throw new AppError(404, 'Page not found');
  await prisma.page.delete({ where: { id: page.id } });
}

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

export async function getPageTree(spaceId: string) {
  const pages = await prisma.page.findMany({
    where: { spaceId },
    select: { id: true, title: true, slug: true, parentId: true, position: true, isDraft: true },
    orderBy: { position: 'asc' },
  });

  type PageNode = typeof pages[number] & { children: PageNode[] };

  // Build tree
  const map = new Map<string | null, typeof pages>();
  for (const page of pages) {
    const parentKey = page.parentId ?? null;
    if (!map.has(parentKey)) map.set(parentKey, []);
    map.get(parentKey)!.push(page);
  }

  function buildTree(parentId: string | null): PageNode[] {
    const children = map.get(parentId) ?? [];
    return children.map((p) => ({ ...p, children: buildTree(p.id) }));
  }

  return buildTree(null);
}
