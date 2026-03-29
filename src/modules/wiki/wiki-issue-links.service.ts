import { prisma } from '../../config/database';
import { broadcastToRoom } from '../../realtime/broadcast';

// Matches issue keys like AXM-123
const ISSUE_KEY_RE = /\b([A-Z][A-Z0-9]+-\d+)\b/g;

/**
 * Extract valid issue IDs from page content by matching issue key patterns
 * and resolving them against the database.
 * @param content - The page body content to scan for issue keys
 * @returns Array of resolved issue IDs
 */
export async function extractIssueIdsFromContent(content: string): Promise<string[]> {
  const keys = new Set<string>();
  let match;
  while ((match = ISSUE_KEY_RE.exec(content)) !== null) {
    keys.add(match[1]);
  }
  if (keys.size === 0) return [];

  const conditions = [...keys].map((key) => {
    const [prefix, numStr] = key.split('-');
    return { project: { prefix }, number: parseInt(numStr, 10) };
  });

  const issues = await prisma.issue.findMany({
    where: { OR: conditions },
    select: { id: true },
  });

  return issues.map((i) => i.id);
}

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
  const result = await prisma.wikiPageIssueLink.upsert({
    where: { pageId_issueId_linkType: { pageId, issueId, linkType } },
    create: { pageId, issueId, linkType, createdById: userId },
    update: {},
  });

  broadcastToRoom(`issue:${issueId}`, { type: 'issue:development-updated', issueId });

  return result;
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
  const removedIssueIds = existing.filter((l) => !newSet.has(l.issueId)).map((l) => l.issueId);
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

  const allAffectedIssueIds = new Set([...toAdd, ...removedIssueIds]);
  for (const issueId of allAffectedIssueIds) {
    broadcastToRoom(`issue:${issueId}`, { type: 'issue:development-updated', issueId });
  }
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
          project: {
            select: {
              id: true,
              prefix: true,
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
