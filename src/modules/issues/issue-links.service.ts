import { LinkType } from '@prisma/client';
import { prisma } from '../../config/database';

export async function getLinks(projectId: string, issueNumber: number) {
  const issue = await prisma.issue.findUnique({
    where: { projectId_number: { projectId, number: issueNumber } },
  });
  if (!issue) throw Object.assign(new Error('Issue not found'), { status: 404 });

  const links = await prisma.issueLink.findMany({
    where: { OR: [{ fromId: issue.id }, { toId: issue.id }] },
    include: {
      from: { include: { project: { select: { prefix: true, slug: true, team: { select: { slug: true, org: { select: { slug: true } } } } } } } },
      to: { include: { project: { select: { prefix: true, slug: true, team: { select: { slug: true, org: { select: { slug: true } } } } } } } },
    },
  });

  return links.map(l => ({
    ...l,
    fromKey: `${l.from.project.prefix}-${l.from.number}`,
    toKey: `${l.to.project.prefix}-${l.to.number}`,
  }));
}

export async function addLink(projectId: string, issueNumber: number, data: {
  targetProjectId: string;
  targetIssueNumber: number;
  type: LinkType;
}) {
  const issue = await prisma.issue.findUnique({
    where: { projectId_number: { projectId, number: issueNumber } },
  });
  if (!issue) throw Object.assign(new Error('Issue not found'), { status: 404 });

  const target = await prisma.issue.findUnique({
    where: { projectId_number: { projectId: data.targetProjectId, number: data.targetIssueNumber } },
  });
  if (!target) throw Object.assign(new Error('Target issue not found'), { status: 404 });

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

export async function deleteLink(linkId: string) {
  await prisma.issueLink.delete({ where: { id: linkId } });
}
