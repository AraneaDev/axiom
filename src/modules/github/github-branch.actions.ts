import { z } from 'zod';

import { defineAction } from '../../actions/define';
import { inputPlace } from '../../actions/places';
import * as previews from '../../actions/previews';
import { registerActions } from '../../actions/registry';
import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { logger } from '../../utils/logger';

import {
  assertBranchName,
  assertRefName,
  branchNameFor,
  githubWrite,
  issueRepo,
  issueTarget,
  linkedBranch,
  refPath,
  repoPath,
  userAuth,
} from './github-actions.helpers';
import { githubRequest } from './github-client';
import { storeBranch, storePullRequest, type PullRequestPayload } from './github-events';

const refReply = z.object({ object: z.object({ sha: z.string().min(1) }) });

const PATH = '/api/projects/:projectId/issues/:issueNumber/github/branches';

const branchTarget = issueTarget.extend({ branch: z.string().min(1).max(200) });

registerActions([
  defineAction({
    name: 'githubBranch.create',
    place: inputPlace,
    area: 'github',
    kind: 'write',
    summary:
      'Create a branch on the linked GitHub repository for an issue, as your own GitHub account. ' +
      'Without a name it is <key>-<title>; a name you give must contain the issue key.',
    target: issueTarget,
    input: issueTarget.extend({
      name: z
        .string()
        .min(1)
        .max(200)
        .optional()
        .describe('The branch name; it must contain the issue key'),
      from: z
        .string()
        .min(1)
        .max(200)
        .optional()
        .describe('The branch to start from; default: the default branch'),
    }),
    output: z.looseObject({ name: z.string(), url: z.string(), headSha: z.string() }),
    rest: { method: 'POST', path: PATH },
    authorize: githubWrite,
    handler: async (ctx, { projectId, issueNumber, name: given, from }) => {
      const { issue, link } = await issueRepo(projectId, issueNumber);
      const prefix = issue.key.slice(0, issue.key.lastIndexOf('-'));
      const name = given ?? branchNameFor(prefix, issueNumber, issue.title);
      assertBranchName(name, issue.key);
      if (from !== undefined) assertRefName(from);
      const { auth, account } = await userAuth(ctx);
      const base = from ?? link.defaultBranch;
      const repo = repoPath(link);

      const head = await githubRequest<unknown>(
        auth,
        'GET',
        `${repo}/git/ref/heads/${refPath(base)}`,
      ).catch((err: unknown) => {
        if (err instanceof AppError && err.code === 'GITHUB_NOT_FOUND') {
          throw new AppError(
            404,
            'The branch to start from was not found on GitHub, or your connection cannot see it',
            'GITHUB_BASE_NOT_FOUND',
          );
        }
        throw err;
      });
      const baseSha = refReply.parse(head.data).object.sha;
      const created = await githubRequest<unknown>(auth, 'POST', `${repo}/git/refs`, {
        body: { ref: `refs/heads/${name}`, sha: baseSha },
      }).catch((err: unknown) => {
        if (
          err instanceof AppError &&
          err.code === 'GITHUB_INVALID' &&
          /already exists/i.test(err.message)
        ) {
          throw new AppError(409, 'A branch with that name already exists', 'GITHUB_BRANCH_EXISTS');
        }
        throw err;
      });
      const headSha = refReply.parse(created.data).object.sha;

      // Stored now, so the issue shows the branch before GitHub's webhook arrives
      // The branch exists on GitHub either way; a store that fails is repaired by the webhook
      await storeBranch(
        link.id,
        { name, sha: headSha },
        { id: account.githubUserId, login: account.login },
        'action',
      ).catch((err: unknown) => {
        logger.warn('github branch created but not stored', {
          repoLinkId: link.id,
          branch: name,
          error: err instanceof Error ? err.message : 'unknown',
        });
      });
      return { name, url: `${link.htmlUrl}/tree/${refPath(name)}`, headSha };
    },
  }),

  defineAction({
    name: 'githubBranch.delete',
    place: inputPlace,
    area: 'github',
    kind: 'write',
    destructive: true,
    alwaysApprove: true,
    summary:
      'Delete a branch linked to an issue on the linked GitHub repository, as your own GitHub ' +
      'account. GitHub closes an open pull request that has the branch as its head. The ' +
      "repository's default branch is refused. A token's call waits for approval in the web UI.",
    target: branchTarget,
    input: branchTarget,
    output: z.looseObject({ name: z.string(), deleted: z.boolean() }),
    preview: (_ctx, { projectId, issueNumber, branch }) =>
      previews.githubBranchDelete(projectId, issueNumber, branch),
    rest: { method: 'DELETE', path: `${PATH}/:branch` },
    authorize: githubWrite,
    handler: async (ctx, { projectId, issueNumber, branch }) => {
      assertRefName(branch);
      const { issue, link } = await issueRepo(projectId, issueNumber);
      if (branch === link.defaultBranch) {
        throw new AppError(400, previews.DEFAULT_BRANCH_MESSAGE, 'GITHUB_DEFAULT_BRANCH');
      }
      const row = await linkedBranch(issue.id, link.id, branch);
      const { auth, account } = await userAuth(ctx);
      const repo = repoPath(link);
      await githubRequest<unknown>(
        auth,
        'DELETE',
        `${repo}/git/refs/heads/${refPath(row.name)}`,
      ).catch((err: unknown) => {
        // A branch that is already gone on GitHub is what the caller wanted
        if (
          err instanceof AppError &&
          err.code === 'GITHUB_INVALID' &&
          /does not exist/i.test(err.message)
        ) {
          return null;
        }
        throw err;
      });
      // The branch is gone on GitHub either way; a store that fails is repaired by the webhook
      await storeBranch(
        link.id,
        { name: row.name, sha: null },
        { id: account.githubUserId, login: account.login },
        'action',
      ).catch((err: unknown) => {
        logger.warn('github branch deleted but not stored', {
          repoLinkId: link.id,
          branch: row.name,
          error: err instanceof Error ? err.message : 'unknown',
        });
      });
      // GitHub closes the open pull request of the branch: shown closed now, not at the webhook
      const open = await prisma.githubPullRequest.findFirst({
        where: { repoLinkId: link.id, headRef: row.name, state: 'OPEN' },
        select: { number: true },
        orderBy: { number: 'asc' },
      });
      if (open) {
        await githubRequest<unknown>(auth, 'GET', `${repo}/pulls/${open.number}`)
          .then((fresh) =>
            storePullRequest(
              link.id,
              fresh.data as PullRequestPayload,
              { id: account.githubUserId, login: account.login },
              'action',
            ),
          )
          .catch((err: unknown) => {
            logger.warn('github branch deleted but its pull request not stored', {
              repoLinkId: link.id,
              pullRequest: open.number,
              error: err instanceof Error ? err.message : 'unknown',
            });
          });
      }
      return { name: row.name, deleted: true };
    },
  }),
]);
