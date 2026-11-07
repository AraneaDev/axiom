import { z } from 'zod';

import { defineAction } from '../../actions/define';
import { registerActions } from '../../actions/registry';
import { AppError } from '../../middleware/errorHandler';
import { logger } from '../../utils/logger';

import {
  assertBranchName,
  assertRefName,
  branchNameFor,
  githubWrite,
  issueRepo,
  issueTarget,
  refPath,
  userAuth,
} from './github-actions.helpers';
import { githubRequest } from './github-client';
import { storeBranch } from './github-events';

const refReply = z.object({ object: z.object({ sha: z.string().min(1) }) });

const PATH = '/api/projects/:projectId/issues/:issueNumber/github/branches';

registerActions([
  defineAction({
    name: 'githubBranch.create',
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
      const repo = `/repos/${encodeURIComponent(link.owner)}/${encodeURIComponent(link.name)}`;

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
]);
