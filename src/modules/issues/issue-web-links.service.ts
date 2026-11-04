import { prisma } from '../../config/database';
import { findOrThrow } from '../../utils/find-or-throw';
import { USER_BASIC_SELECT } from '../../utils/prisma-selects';

import { findIssueOrThrow } from './issue-utils';

const WEB_LINK_INCLUDE = { createdBy: { select: USER_BASIC_SELECT } };

/**
 * Add an external link to an issue.
 * @param projectId - The project the issue is in
 * @param issueNumber - The issue's number within the project
 * @param userId - Who adds it
 * @param data - The link
 * @param data.url - An http or https URL
 * @param data.title - What to show instead of the URL
 * @returns The created link with its author
 * @throws {AppError} 404 when the issue does not exist
 */
export async function addWebLink(
  projectId: string,
  issueNumber: number,
  userId: string,
  data: { url: string; title?: string },
) {
  const issue = await findIssueOrThrow(projectId, issueNumber);
  return prisma.issueWebLink.create({
    data: { issueId: issue.id, url: data.url, title: data.title ?? null, createdById: userId },
    include: WEB_LINK_INCLUDE,
  });
}

/**
 * The external links of an issue, oldest first.
 * @param projectId - The project the issue is in
 * @param issueNumber - The issue's number within the project
 * @throws {AppError} 404 when the issue does not exist
 */
export async function listWebLinks(projectId: string, issueNumber: number) {
  const issue = await findIssueOrThrow(projectId, issueNumber);
  return prisma.issueWebLink.findMany({
    where: { issueId: issue.id },
    include: WEB_LINK_INCLUDE,
    orderBy: { createdAt: 'asc' },
  });
}

/**
 * Remove an external link from an issue.
 * @param projectId - The project the issue is in
 * @param issueNumber - The issue's number within the project
 * @param linkId - The link
 * @throws {AppError} 404 when the issue does not exist, or the link is not on it
 */
export async function deleteWebLink(projectId: string, issueNumber: number, linkId: string) {
  const issue = await findIssueOrThrow(projectId, issueNumber);
  const link = await findOrThrow(
    prisma.issueWebLink.findFirst({ where: { id: linkId, issueId: issue.id } }),
    'Web link not found',
  );
  await prisma.issueWebLink.delete({ where: { id: link.id } });
}
