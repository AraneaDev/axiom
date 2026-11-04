import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { checkProjectAccess } from '../../middleware/requireProjectAccess';
import { broadcastToRoom } from '../../realtime/broadcast';
import { onBodySaved } from '../../realtime/yjs-persistence';
import { ERR } from '../../utils/error-messages';
import { formatIssueKey } from '../../utils/issue-key';
import {
  PROJECT_URL_SELECT,
  SPACE_URL_SELECT,
  USER_WITH_AVATAR_SELECT,
} from '../../utils/prisma-selects';
import { viewableIssuesWhere, viewablePagesWhere } from '../search/search-access';

// Matches issue keys like AXM-123
const ISSUE_KEY_RE = /\b([A-Z][A-Z0-9]+-\d+)\b/g;

/**
 * The issue keys a page body names, whether or not they resolve to anything.
 * @param content - The page body
 */
function issueKeysIn(content: string): Set<string> {
  return new Set([...content.matchAll(ISSUE_KEY_RE)].map((match) => match[1]));
}

/**
 * Extract the ids of issues a page body mentions by key (AXM-123). A key only resolves to
 * an issue in the page's own org that the author can open: prefixes are only unique per
 * team, and a mention must not link (and so show) issues from elsewhere.
 * @param content - The page body content to scan for issue keys
 * @param pageId - The page being written
 * @param authorId - Who wrote it
 * @returns Array of resolved issue IDs
 */
export async function extractIssueIdsFromContent(
  content: string,
  pageId: string,
  authorId: string,
): Promise<string[]> {
  const keys = issueKeysIn(content);
  if (keys.size === 0) return [];

  const page = await prisma.page.findUnique({
    where: { id: pageId },
    select: { space: { select: { team: { select: { orgId: true } } } } },
  });
  if (!page) return [];

  const conditions = [...keys].map((key) => {
    const [prefix, numStr] = key.split('-');
    return { project: { prefix }, number: parseInt(numStr, 10) };
  });

  const issues = await prisma.issue.findMany({
    where: {
      OR: conditions,
      AND: [
        { project: { team: { orgId: page.space.team.orgId } } },
        await viewableIssuesWhere(authorId),
      ],
    },
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

  broadcastToRoom(`issue:${issueId}`, { type: 'issue:links-updated', issueId });

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
  const result = await prisma.wikiPageIssueLink.deleteMany({
    where: { pageId, issueId, linkType: 'EMBED' },
  });
  if (result.count > 0) {
    broadcastToRoom(`issue:${issueId}`, { type: 'issue:links-updated', issueId });
  }
  return result;
}

/**
 * Make the MENTION rows of a page follow a body just written. Every writer of Page.body comes
 * through here, because these rows are what the links of an issue are read from.
 * @param pageId - The page
 * @param body - The body as stored
 * @param authorId - Who wrote it
 */
export async function syncBodyMentions(pageId: string, body: string, authorId: string) {
  const issueIds = await extractIssueIdsFromContent(body, pageId, authorId);
  await syncMentionLinks(pageId, issueIds, authorId, issueKeysIn(body));
}

onBodySaved(syncBodyMentions);

/**
 *
 * @param pageId
 * @param issueIds
 * @param userId
 * @param mentionedKeys - The keys the body names. A link whose key is gone from it goes, whoever
 * wrote this edit. Without it, only links to issues the author can see can go.
 */
export async function syncMentionLinks(
  pageId: string,
  issueIds: string[],
  userId: string,
  mentionedKeys?: Set<string>,
) {
  const existing = await prisma.wikiPageIssueLink.findMany({
    where: { pageId, linkType: 'MENTION' },
  });

  const existingSet = new Set(existing.map((l) => l.issueId));
  const newSet = new Set(issueIds);

  // The new set only holds issues this author can resolve. A link to an issue they can't
  // see was made by someone who could, and while the body still names it this edit says nothing
  // about it: keep it.
  const dropped = existing.filter((l) => !newSet.has(l.issueId));
  const unnamed =
    mentionedKeys && dropped.length > 0
      ? (
          await prisma.issue.findMany({
            where: { id: { in: dropped.map((l) => l.issueId) } },
            select: { id: true, number: true, project: { select: { prefix: true } } },
          })
        )
          .filter((i) => !mentionedKeys.has(formatIssueKey(i.project.prefix, i.number)))
          .map((i) => i.id)
      : [];
  const removable = new Set([
    ...unnamed,
    ...(dropped.length === 0
      ? []
      : (
          await prisma.issue.findMany({
            where: {
              AND: [
                { id: { in: dropped.map((l) => l.issueId) } },
                await viewableIssuesWhere(userId),
              ],
            },
            select: { id: true },
          })
        ).map((i) => i.id)),
  ]);

  const toAdd = issueIds.filter((id) => !existingSet.has(id));
  const removedIssueIds = dropped.filter((l) => removable.has(l.issueId)).map((l) => l.issueId);
  const toRemove = dropped.filter((l) => removable.has(l.issueId)).map((l) => l.id);

  if (toAdd.length === 0 && toRemove.length === 0) return;

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
    broadcastToRoom(`issue:${issueId}`, { type: 'issue:links-updated', issueId });
  }
}

/**
 *
 * @param pageId
 * @param viewerId - Who is looking
 */
export async function getLinksForPage(pageId: string, viewerId: string) {
  // Only issues the viewer could open: a link would otherwise show any issue's details
  return prisma.wikiPageIssueLink.findMany({
    where: { pageId, issue: await viewableIssuesWhere(viewerId) },
    include: {
      issue: {
        select: {
          id: true,
          number: true,
          title: true,
          priority: true,
          type: true,
          column: { select: { id: true, name: true } },
          assignee: { select: USER_WITH_AVATAR_SELECT },
          project: { select: { id: true, ...PROJECT_URL_SELECT } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Find an issue by project ID and issue number.
 * @param projectId - The project ID
 * @param issueNumber - The issue number within the project
 * @returns The issue or null if not found
 */
export async function findIssueByNumber(projectId: string, issueNumber: number) {
  return prisma.issue.findFirst({
    where: { projectId, number: issueNumber },
    select: { id: true },
  });
}

/**
 *
 * @param issueId
 * @param viewerId - Who is looking
 */
export async function getLinksForIssue(issueId: string, viewerId: string) {
  // Only pages the viewer could open: closed spaces and restricted pages stay hidden
  return prisma.wikiPageIssueLink.findMany({
    where: { issueId, page: await viewablePagesWhere(viewerId) },
    include: {
      page: {
        select: {
          id: true,
          title: true,
          slug: true,
          space: { select: SPACE_URL_SELECT },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Link an issue to a page for a user. The issue must be one the user can open, because the link
 * shows its details on the page.
 * @param pageId - The page
 * @param issueId - The issue
 * @param linkType - EMBED or MENTION
 * @param userId - Who links it
 * @throws {AppError} 404 when the issue does not exist, 403 when the user cannot open it
 */
export async function addLinkForUser(
  pageId: string,
  issueId: string,
  linkType: 'EMBED' | 'MENTION',
  userId: string,
) {
  const issue = await prisma.issue.findUnique({
    where: { id: issueId },
    select: { projectId: true },
  });
  if (!issue) throw new AppError(404, ERR.ISSUE_NOT_FOUND);
  if ((await checkProjectAccess(userId, issue.projectId)) !== 'ok') {
    throw new AppError(403, ERR.ACCESS_DENIED, 'FORBIDDEN');
  }
  return addLink(pageId, issueId, linkType, userId);
}
