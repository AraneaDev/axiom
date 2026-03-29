import { prisma } from '../../config/database';

/**
 *
 * @param pageId
 * @param issueId
 * @param linkType
 * @param userId
 */
export async function addLink(
  pageId: string,
  issueId: string,
  linkType: 'EMBED' | 'MENTION',
  userId: string,
) {
  return prisma.wikiPageIssueLink.upsert({
    where: { pageId_issueId_linkType: { pageId, issueId, linkType } },
    create: { pageId, issueId, linkType, createdById: userId },
    update: {},
  });
}

export const addEmbedLink = (pageId: string, issueId: string, userId: string) =>
  addLink(pageId, issueId, 'EMBED', userId);

/**
 *
 * @param pageId
 * @param issueId
 */
export async function removeEmbedLink(pageId: string, issueId: string) {
  return prisma.wikiPageIssueLink.deleteMany({
    where: { pageId, issueId, linkType: 'EMBED' },
  });
}

/**
 *
 * @param pageId
 * @param issueIds
 * @param userId
 */
export async function syncMentionLinks(pageId: string, issueIds: string[], userId: string) {
  const existing = await prisma.wikiPageIssueLink.findMany({
    where: { pageId, linkType: 'MENTION' },
  });

  const existingSet = new Set(existing.map((l) => l.issueId));
  const newSet = new Set(issueIds);

  const toAdd = issueIds.filter((id) => !existingSet.has(id));
  const toRemove = existing.filter((l) => !newSet.has(l.issueId)).map((l) => l.id);

  await prisma.$transaction([
    ...toAdd.map((issueId) =>
      prisma.wikiPageIssueLink.create({
        data: { pageId, issueId, linkType: 'MENTION', createdById: userId },
      }),
    ),
    ...(toRemove.length
      ? [prisma.wikiPageIssueLink.deleteMany({ where: { id: { in: toRemove } } })]
      : []),
  ]);
}

/**
 *
 * @param pageId
 */
export async function getLinksForPage(pageId: string) {
  return prisma.wikiPageIssueLink.findMany({
    where: { pageId },
    include: {
      issue: {
        select: {
          id: true,
          number: true,
          title: true,
          priority: true,
          type: true,
          column: { select: { id: true, name: true } },
          assignee: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
          project: { select: { id: true, prefix: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 *
 * @param issueId
 */
export async function getLinksForIssue(issueId: string) {
  return prisma.wikiPageIssueLink.findMany({
    where: { issueId },
    include: {
      page: {
        select: {
          id: true,
          title: true,
          slug: true,
          space: {
            select: {
              id: true,
              name: true,
              slug: true,
              team: { select: { slug: true, org: { select: { slug: true } } } },
            },
          },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });
}
