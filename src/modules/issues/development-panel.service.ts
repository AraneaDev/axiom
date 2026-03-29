import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { getLinksForIssue } from '../wiki/wiki-issue-links.service';

export interface DevelopmentSummary {
  branches: Array<{
    id: string;
    repoId: string;
    repoName: string;
    branchName: string;
    createdAt: Date;
  }>;
  commits: Array<{
    id: string;
    repoId: string;
    repoName: string;
    sha: string;
    message: string;
    authorName: string;
    committedAt: Date;
  }>;
  pullRequests: Array<{
    id: string;
    repoId: string;
    repoName: string;
    number: number;
    title: string;
    status: string;
    authorName: string;
    createdAt: Date;
  }>;
  pipelines: Array<{
    id: string;
    repoName: string;
    pipelineName: string;
    status: string;
    ref: string;
    createdAt: Date;
  }>;
  wikiPages: Array<{
    id: string;
    linkType: string;
    page: {
      id: string;
      title: string;
      slug: string;
      space: {
        id: string;
        name: string;
        slug: string;
        team: { slug: string; org: { slug: string } };
      };
    };
  }>;
}

/**
 *
 * @param projectId
 * @param issueNumber
 */
export async function getDevelopmentSummary(
  projectId: string,
  issueNumber: number,
): Promise<DevelopmentSummary> {
  const issue = await prisma.issue.findFirst({
    where: { projectId, number: issueNumber },
    select: { id: true },
  });

  if (!issue) {
    throw new AppError(404, 'Issue not found');
  }

  const issueId = issue.id;

  const [branches, commits, issuePRs, pipelineRuns, wikiLinks] = await Promise.all([
    prisma.issueBranch.findMany({
      where: { issueId },
      include: { repo: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    }),

    prisma.issueCommit.findMany({
      where: { issueId },
      include: { repo: { select: { name: true } } },
      orderBy: { committedAt: 'desc' },
      take: 20,
    }),

    prisma.issuePullRequest.findMany({
      where: { issueId },
      include: {
        pr: {
          include: {
            repo: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    }),

    // Find pipeline runs for branches linked to this issue
    prisma.issueBranch
      .findMany({
        where: { issueId },
        select: { branchName: true, repoId: true },
      })
      .then((issueBranches) => {
        if (issueBranches.length === 0) return [];
        return prisma.pipelineRun.findMany({
          where: {
            OR: issueBranches.map((b) => ({
              repoId: b.repoId,
              triggerRef: b.branchName,
            })),
          },
          include: {
            pipeline: { select: { name: true } },
            repo: { select: { name: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 20,
        });
      }),

    getLinksForIssue(issueId),
  ]);

  // Resolve PR author names
  const authorIds = [...new Set(issuePRs.map((ipr) => ipr.pr.authorId))];
  const authors =
    authorIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: authorIds } },
          select: { id: true, displayName: true },
        })
      : [];
  const authorMap = new Map(authors.map((a) => [a.id, a.displayName]));

  return {
    branches: branches.map((b) => ({
      id: b.id,
      repoId: b.repoId,
      repoName: b.repo.name,
      branchName: b.branchName,
      createdAt: b.createdAt,
    })),
    commits: commits.map((c) => ({
      id: c.id,
      repoId: c.repoId,
      repoName: c.repo.name,
      sha: c.sha,
      message: c.message,
      authorName: c.authorName,
      committedAt: c.committedAt,
    })),
    pullRequests: issuePRs.map((ipr) => ({
      id: ipr.id,
      repoId: ipr.pr.repoId,
      repoName: ipr.pr.repo.name,
      number: ipr.pr.number,
      title: ipr.pr.title,
      status: ipr.pr.status,
      authorName: authorMap.get(ipr.pr.authorId) || 'Unknown',
      createdAt: ipr.createdAt,
    })),
    pipelines: pipelineRuns.map((r) => ({
      id: r.id,
      repoName: r.repo.name,
      pipelineName: r.pipeline.name,
      status: r.status,
      ref: r.triggerRef,
      createdAt: r.createdAt,
    })),
    wikiPages: wikiLinks.map((l) => ({
      id: l.id,
      linkType: l.linkType,
      page: l.page,
    })),
  };
}
