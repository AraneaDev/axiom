// What every action that writes to GitHub as the caller shares: the target (an issue), the
// authorization (issue write in Axiom), the issue's repository, and the GitHub identity of the
// caller. Authorization runs before any of these touches GitHub.
import type { GithubBranch, GithubPullRequest, GithubRepoLink } from '@prisma/client';
import { z } from 'zod';

import { projectAction } from '../../actions/authorize';
import type { ActionContext } from '../../actions/define';
import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { formatIssueKey } from '../../utils/issue-key';
import { strictInt } from '../../utils/validation/common-validators';

import { requireGithubAccount } from './github-actor';
import type { GithubAuth } from './github-client';
import { extractIssueNumbers } from './issue-keys';
import { findRepoLinkByProject } from './repo-link.service';

/** The issue a GitHub action works on; authorization reads these ids and nothing else */
export const issueTarget = z.object({ projectId: z.string(), issueNumber: strictInt });
export type IssueTarget = z.infer<typeof issueTarget>;

/** A GitHub write needs issue write in Axiom; GitHub then decides for the caller's own account */
export const githubWrite = projectAction<IssueTarget>('issue:edit', (i) => i.projectId);

const MAX_BRANCH_NAME = 200;
const MAX_SLUG = 40;

/**
 * The issue and the repository its project is linked to.
 * @param projectId The project
 * @param issueNumber The issue's number in the project
 * @throws {AppError} 404 for a missing issue, 409 GITHUB_NOT_LINKED for a project without a link
 */
export async function issueRepo(
  projectId: string,
  issueNumber: number,
): Promise<{ issue: { id: string; title: string; key: string }; link: GithubRepoLink }> {
  const found = await prisma.issue.findUnique({
    where: { projectId_number: { projectId, number: issueNumber } },
    select: { id: true, title: true, number: true, project: { select: { prefix: true } } },
  });
  if (!found) throw new AppError(404, 'Issue not found', 'NOT_FOUND');
  const link = await findRepoLinkByProject(projectId);
  if (!link) {
    throw new AppError(409, 'This project has no linked GitHub repository', 'GITHUB_NOT_LINKED');
  }
  return {
    issue: {
      id: found.id,
      title: found.title,
      key: formatIssueKey(found.project.prefix, found.number),
    },
    link,
  };
}

const notLinkedToIssue = (what: string) =>
  new AppError(404, `That ${what} is not linked to this issue`, 'GITHUB_NOT_LINKED_TO_ISSUE');

/**
 * A pull request of the issue's repository that is linked to the issue.
 * @param issueId The issue
 * @param pullNumber The pull request's number on GitHub
 * @throws {AppError} 404 GITHUB_NOT_LINKED_TO_ISSUE when it is none of the issue's
 */
export async function linkedPullRequest(
  issueId: string,
  pullNumber: number,
): Promise<GithubPullRequest> {
  const links = await prisma.githubIssueLink.findMany({
    where: { issueId, targetType: 'PULL_REQUEST' },
    select: { targetKey: true },
  });
  const pr = links.length
    ? await prisma.githubPullRequest.findFirst({
        where: { id: { in: links.map((l) => l.targetKey) }, number: pullNumber },
      })
    : null;
  if (!pr) throw notLinkedToIssue('pull request');
  return pr;
}

/**
 * A branch of the issue's repository that is linked to the issue and not deleted.
 * @param issueId The issue
 * @param name The branch name
 * @throws {AppError} 404 GITHUB_NOT_LINKED_TO_ISSUE when it is none of the issue's
 */
export async function linkedBranch(issueId: string, name: string): Promise<GithubBranch> {
  const links = await prisma.githubIssueLink.findMany({
    where: { issueId, targetType: 'BRANCH' },
    select: { targetKey: true },
  });
  const branch = links.length
    ? await prisma.githubBranch.findFirst({
        where: { id: { in: links.map((l) => l.targetKey) }, name, deletedAt: null },
      })
    : null;
  if (!branch) throw notLinkedToIssue('branch');
  return branch;
}

/**
 * The credential of a call made as the caller. There is no fallback to the App or a bot.
 * @param ctx Who runs the action
 * @throws {AppError} 409 GITHUB_NOT_CONNECTED
 */
export async function userAuth(ctx: ActionContext): Promise<GithubAuth> {
  await requireGithubAccount(ctx.userId);
  return { kind: 'user', userId: ctx.userId };
}

/**
 * The branch name for an issue: `<prefix lower>-<number>-<title slug>`. The slug is the title in
 * lower-case ASCII with every other run of characters as one `-`, cut to 40 characters at a `-`.
 * @param prefix The project's key prefix
 * @param number The issue number
 * @param title The issue title
 */
export function branchNameFor(prefix: string, number: number, title: string): string {
  let slug = title
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (slug.length > MAX_SLUG) {
    // The 41st character a `-` means the first 40 end on a whole word
    const cut = slug.slice(0, MAX_SLUG);
    slug = slug[MAX_SLUG] === '-' || !cut.includes('-') ? cut : cut.slice(0, cut.lastIndexOf('-'));
    slug = slug.replace(/-+$/, '');
  }
  const head = `${prefix.toLowerCase()}-${number}`;
  return slug ? `${head}-${slug}` : head;
}

// Control characters are refused on purpose: git's ref rules forbid them
// eslint-disable-next-line no-control-regex
const REFUSED_CHARACTERS = /[\u0000- \u007f~^:?*[\\]/;

/**
 * Refuses what git's ref rules refuse (`git check-ref-format`), so GitHub never has to.
 * @param name A branch name
 * @throws {AppError} 400 INVALID_BRANCH_NAME
 */
export function assertRefName(name: string): void {
  const bad = (reason: string) =>
    new AppError(400, `Not a valid branch name: ${reason}`, 'INVALID_BRANCH_NAME');
  if (!name) throw bad('it is empty');
  if (name.length > MAX_BRANCH_NAME) throw bad(`it is longer than ${MAX_BRANCH_NAME} characters`);
  if (REFUSED_CHARACTERS.test(name)) {
    throw bad('it has a space, a control character or one of ~ ^ : ? * [ \\');
  }
  if (name.startsWith('-')) throw bad('it starts with "-"');
  if (name === '@' || name.includes('@{')) throw bad('it has "@{" or is "@"');
  if (name.includes('..')) throw bad('it has ".."');
  if (name.startsWith('/') || name.endsWith('/') || name.includes('//')) {
    throw bad('it has an empty part between slashes');
  }
  if (name.endsWith('.')) throw bad('it ends with "."');
  for (const part of name.split('/')) {
    if (part.startsWith('.')) throw bad('a part starts with "."');
    if (part.endsWith('.lock')) throw bad('a part ends with ".lock"');
  }
}

/**
 * A branch name the caller chose: valid for git, at most 200 characters, and naming the issue,
 * so the branch links to it.
 * @param name The branch name
 * @param key The issue's key, such as AXM-42
 * @throws {AppError} 400 INVALID_BRANCH_NAME
 */
export function assertBranchName(name: string, key: string): void {
  assertRefName(name);
  const split = key.lastIndexOf('-');
  const named = extractIssueNumbers(name, key.slice(0, split)).includes(
    Number(key.slice(split + 1)),
  );
  if (!named) {
    throw new AppError(
      400,
      `Not a valid branch name: it must contain the issue key ${key}`,
      'INVALID_BRANCH_NAME',
    );
  }
}

/**
 * A ref name as it goes into a GitHub API path: each part encoded, the slashes kept.
 * @param name A branch name
 */
export const refPath = (name: string): string => name.split('/').map(encodeURIComponent).join('/');
