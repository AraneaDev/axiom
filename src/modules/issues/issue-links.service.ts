import { LinkType } from '@prisma/client';

import { prisma } from '../../config/database';
import { ERR } from '../../utils/error-messages';
import { findOrThrow } from '../../utils/find-or-throw';
import { PROJECT_URL_SELECT } from '../../utils/prisma-selects';
import { viewableIssuesWhere } from '../search/search-access';

/** What a link shows of the issue at either end. */
const LINKED_ISSUE_SELECT = {
  id: true,
  number: true,
  title: true,
  project: { select: PROJECT_URL_SELECT },
} as const;

/**
 *
 * @param projectId
 * @param issueNumber
 * @param viewerId - Who is looking
 */
export async function getLinks(projectId: string, issueNumber: number, viewerId: string) {
  const issue = await findOrThrow(
    prisma.issue.findUnique({
      where: { projectId_number: { projectId, number: issueNumber } },
    }),
    ERR.ISSUE_NOT_FOUND,
  );

  // Only links whose other end the viewer can open, showing what a link needs and no more: a link
  // made by someone in both projects must not hand the other issue to everyone in this one
  const otherEnd = await viewableIssuesWhere(viewerId);
  const links = await prisma.issueLink.findMany({
    where: {
      OR: [
        { fromId: issue.id, to: otherEnd },
        { toId: issue.id, from: otherEnd },
      ],
    },
    select: {
      id: true,
      fromId: true,
      toId: true,
      type: true,
      createdAt: true,
      from: { select: LINKED_ISSUE_SELECT },
      to: { select: LINKED_ISSUE_SELECT },
    },
  });

  return links.map((l: (typeof links)[number]) => ({
    ...l,
    fromKey: `${l.from.project.prefix}-${l.from.number}`,
    toKey: `${l.to.project.prefix}-${l.to.number}`,
  }));
}

/**
 *
 * @param projectId
 * @param issueNumber
 * @param data
 * @param data.targetProjectId
 * @param data.targetIssueNumber
 * @param data.type
 */
export async function addLink(
  projectId: string,
  issueNumber: number,
  data: {
    targetProjectId: string;
    targetIssueNumber: number;
    type: LinkType;
  },
) {
  const issue = await findOrThrow(
    prisma.issue.findUnique({
      where: { projectId_number: { projectId, number: issueNumber } },
    }),
    ERR.ISSUE_NOT_FOUND,
  );

  const target = await findOrThrow(
    prisma.issue.findUnique({
      where: {
        projectId_number: { projectId: data.targetProjectId, number: data.targetIssueNumber },
      },
    }),
    'Target issue not found',
  );

  const link = await prisma.issueLink.create({
    data: { fromId: issue.id, toId: target.id, type: data.type },
  });

  // Create inverse link for bidirectional types
  if (data.type === 'BLOCKS') {
    await prisma.issueLink.upsert({
      where: { fromId_toId_type: { fromId: target.id, toId: issue.id, type: 'IS_BLOCKED_BY' } },
      create: { fromId: target.id, toId: issue.id, type: 'IS_BLOCKED_BY' },
      update: {},
    });
  } else if (data.type === 'IS_BLOCKED_BY') {
    await prisma.issueLink.upsert({
      where: { fromId_toId_type: { fromId: target.id, toId: issue.id, type: 'BLOCKS' } },
      create: { fromId: target.id, toId: issue.id, type: 'BLOCKS' },
      update: {},
    });
  }

  return link;
}

/**
 *
 * @param linkId
 */
export async function deleteLink(linkId: string) {
  await prisma.issueLink.delete({ where: { id: linkId } });
}
