import { prisma } from '../../config/database';

export async function getCommits(projectId: string, issueNumber: number) {
  const issue = await prisma.issue.findUnique({
    where: { projectId_number: { projectId, number: issueNumber } },
  });
  if (!issue) throw Object.assign(new Error('Issue not found'), { status: 404 });

  return prisma.issueCommit.findMany({
    where: { issueId: issue.id },
    include: { repo: { select: { id: true, slug: true, name: true, team: { select: { slug: true, org: { select: { slug: true } } } } } } },
    orderBy: { committedAt: 'desc' },
  });
}
