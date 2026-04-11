import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { ERR } from '../../utils/error-messages';
import { findOrThrow } from '../../utils/find-or-throw';
import { formatIssueKey } from '../../utils/issue-key';
import { USER_BASIC_SELECT } from '../../utils/prisma-selects';

import { findIssueOrThrow } from './issue-utils';

/**
 * Get pull requests linked to an issue.
 * @param projectId - The project the issue belongs to
 * @param issueNumber - The issue number within the project
 * @returns List of linked pull requests with basic PR details
 * @throws {AppError} 404 if issue not found
 */
export async function getIssuePullRequests(projectId: string, issueNumber: number) {
  const issue = await findIssueOrThrow(projectId, issueNumber);

  return prisma.issuePullRequest.findMany({
    where: { issueId: issue.id },
    include: {
      pr: {
        select: {
          id: true,
          number: true,
          title: true,
          status: true,
          sourceBranch: true,
          repo: { select: { id: true, slug: true, name: true } },
        },
      },
    },
  });
}

/**
 * Set the parent of an issue for epic hierarchy, validating against circular references.
 * @param projectId - The project both issues belong to
 * @param issueNumber - The child issue number
 * @param parentIssueNumber - The parent issue number, or null to remove the parent
 * @returns The updated issue with assignee, labels, and column relations
 * @throws {AppError} 404 if issue or parent not found
 * @throws {AppError} 400 if circular reference detected or self-reference
 */
export async function setParent(
  projectId: string,
  issueNumber: number,
  parentIssueNumber: number | null,
) {
  const issue = await findIssueOrThrow(projectId, issueNumber);

  if (parentIssueNumber === null) {
    return prisma.issue.update({
      where: { id: issue.id },
      data: { parentId: null },
      include: {
        assignee: { select: USER_BASIC_SELECT },
        labels: true,
        column: true,
      },
    });
  }

  const parent = await findOrThrow(
    prisma.issue.findUnique({
      where: { projectId_number: { projectId, number: parentIssueNumber } },
    }),
    'Parent issue not found',
  );
  if (parent.id === issue.id) throw new AppError(400, 'An issue cannot be its own parent');

  // Check for circular references: walk up from the proposed parent
  let current = parent;
  while (current.parentId) {
    if (current.parentId === issue.id) {
      throw new AppError(400, 'Circular parent reference detected');
    }
    const next = await prisma.issue.findUnique({ where: { id: current.parentId } });
    if (!next) break;
    current = next;
  }

  return prisma.issue.update({
    where: { id: issue.id },
    data: { parentId: parent.id },
    include: {
      assignee: { select: USER_BASIC_SELECT },
      labels: true,
      column: true,
    },
  });
}

/**
 * Get child issues of a given issue.
 * @param projectId - The project the parent issue belongs to
 * @param issueNumber - The parent issue number
 * @returns List of child issues with computed keys
 * @throws {AppError} 404 if project or issue not found
 */
export async function getChildren(projectId: string, issueNumber: number) {
  const project = await findOrThrow(
    prisma.project.findUnique({ where: { id: projectId } }),
    ERR.PROJECT_NOT_FOUND,
  );

  const issue = await findIssueOrThrow(projectId, issueNumber);

  const children = await prisma.issue.findMany({
    where: { parentId: issue.id },
    include: {
      assignee: { select: USER_BASIC_SELECT },
      labels: true,
      column: { select: { id: true, name: true, isDone: true } },
    },
    orderBy: { number: 'asc' },
  });

  return children.map((c: (typeof children)[number]) => ({
    ...c,
    key: formatIssueKey(project.prefix, c.number),
  }));
}
