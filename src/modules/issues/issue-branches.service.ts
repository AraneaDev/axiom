import { prisma } from '../../config/database';
import * as gitCmd from '../../git/git-commands';
import { repoExists } from '../../git/repo-manager';
import { REPO_URL_SELECT } from '../../utils/prisma-selects';

/**
 *
 * @param type
 * @param prefix
 * @param number
 * @param title
 */
export function suggestBranchName(
  type: string,
  prefix: string,
  number: number,
  title: string,
): string {
  const typePrefix = type === 'BUG' ? 'bugfix' : type === 'EPIC' ? 'epic' : 'feature';
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .split(/\s+/)
    .slice(0, 5)
    .join('-');
  return `${typePrefix}/${prefix}-${number}-${slug}`;
}

/**
 *
 * @param projectId
 * @param issueNumber
 */
export async function getBranches(projectId: string, issueNumber: number) {
  const issue = await prisma.issue.findUnique({
    where: { projectId_number: { projectId, number: issueNumber } },
  });
  if (!issue) throw Object.assign(new Error('Issue not found'), { status: 404 });

  return prisma.issueBranch.findMany({
    where: { issueId: issue.id },
    include: {
      repo: { select: REPO_URL_SELECT },
    },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 *
 * @param projectId
 * @param issueNumber
 * @param userId
 * @param data
 * @param data.repoId
 * @param data.branchName
 * @param data.startPoint
 */
export async function createBranch(
  projectId: string,
  issueNumber: number,
  userId: string,
  data: {
    repoId: string;
    branchName: string;
    startPoint?: string;
  },
) {
  const issue = await prisma.issue.findUnique({
    where: { projectId_number: { projectId, number: issueNumber } },
    include: { project: { select: { prefix: true } } },
  });
  if (!issue) throw Object.assign(new Error('Issue not found'), { status: 404 });

  const repo = await prisma.repository.findUnique({
    where: { id: data.repoId },
    include: { team: { select: { id: true } } },
  });
  if (!repo?.diskPath || !(await repoExists(repo.diskPath))) {
    throw Object.assign(new Error('Repository not found'), { status: 404 });
  }

  // Ensure repo belongs to the same team as the project
  const project = await prisma.project.findUnique({
    where: { id: issue.projectId },
    select: { teamId: true },
  });
  if (repo.team.id !== project?.teamId) {
    throw Object.assign(new Error('Repository does not belong to this project team'), {
      status: 403,
    });
  }

  // Validate branch name
  if (!/^[a-zA-Z0-9._\-/]+$/.test(data.branchName) || data.branchName.length > 250) {
    throw Object.assign(new Error('Invalid branch name'), { status: 400 });
  }

  if (await gitCmd.branchExists(repo.diskPath, data.branchName)) {
    throw Object.assign(new Error('Branch already exists'), { status: 409 });
  }

  const startPoint = data.startPoint ?? repo.defaultBranch;
  await gitCmd.createBranch(repo.diskPath, data.branchName, startPoint);

  return prisma.issueBranch.create({
    data: {
      issueId: issue.id,
      repoId: data.repoId,
      branchName: data.branchName,
      createdById: userId,
    },
    include: { repo: { select: { id: true, slug: true, name: true } } },
  });
}

/**
 *
 * @param projectId
 * @param issueNumber
 */
export async function getSuggestedName(projectId: string, issueNumber: number): Promise<string> {
  const issue = await prisma.issue.findUnique({
    where: { projectId_number: { projectId, number: issueNumber } },
    include: { project: { select: { prefix: true } } },
  });
  if (!issue) return 'feature/branch';
  return suggestBranchName(issue.type, issue.project.prefix, issue.number, issue.title);
}
