import crypto from 'crypto';

import { CommitRefType } from '@prisma/client';
import { Request, Response, NextFunction, Router } from 'express';

import { prisma } from '../config/database';
import { env } from '../config/env';
import { cacheInvalidate } from '../config/redis';
import { executeSmartCommit } from '../modules/issues/smart-commits.executor';
import { triggerPipelineOnPush } from '../pipelines/trigger';
import { broadcastToRoom } from '../realtime/broadcast';
import { ERR } from '../utils/error-messages';
import { logger } from '../utils/logger';

import * as gitCmd from './git-commands';

const ISSUE_KEY_IN_BRANCH = /([A-Z]+-\d+)/;

export const HOOK_SECRET = env.HOOK_SECRET;

/**
 * Compare the request's hook secret against the configured one in constant time,
 * so a timing side channel can't be used to guess it byte by byte.
 * `crypto.timingSafeEqual` throws on unequal-length buffers, so a length
 * mismatch is rejected up front instead.
 * @param provided - Value of the X-Hook-Secret header
 * @param expected - Configured HOOK_SECRET
 * @returns True when both values match exactly
 */
function timingSafeEqualStrings(provided: string, expected: string): boolean {
  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);
  if (providedBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(providedBuf, expectedBuf);
}

const router = Router();

interface PostReceivePayload {
  repo: string; // repo ID
  ref: string; // e.g., refs/heads/main
  before: string; // old SHA
  after: string; // new SHA
}

/**
 * POST /api/internal/hooks/post-receive
 * Called by the post-receive hook script installed in bare repos.
 * Verifies the hook secret header.
 */
router.post('/post-receive', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const secret = req.headers['x-hook-secret'];
    if (typeof secret !== 'string' || !timingSafeEqualStrings(secret, HOOK_SECRET)) {
      return res.status(403).json({ error: 'Invalid hook secret' });
    }

    const payload = req.body as PostReceivePayload;
    if (!payload.repo || !payload.ref || !payload.after) {
      return res.status(400).json({ error: 'Invalid payload' });
    }

    const repo = await prisma.repository.findUnique({
      where: { id: payload.repo },
      include: {
        webhooks: { where: { active: true } },
        team: { include: { org: true } },
      },
    });

    if (!repo) {
      return res.status(404).json({ error: ERR.REPOSITORY_NOT_FOUND });
    }

    // Determine event type
    const refName = payload.ref.replace('refs/heads/', '').replace('refs/tags/', '');
    const isTag = payload.ref.startsWith('refs/tags/');
    const isDelete = payload.after === '0000000000000000000000000000000000000000';
    const isCreate = payload.before === '0000000000000000000000000000000000000000';

    let event = 'push';
    if (isTag) {
      event = isDelete ? 'tag:deleted' : 'tag:created';
    } else if (isDelete) {
      event = 'branch:deleted';
    } else if (isCreate) {
      event = 'branch:created';
    }

    // Detect and log force pushes against protected branches
    const branch = refName;
    if (!isCreate && !isDelete && !isTag) {
      try {
        const { getMatchingRule } = await import('../modules/repos/protection.service');
        const rule = await getMatchingRule(repo.id, branch);
        if (rule?.noForcePush) {
          logger.warn('Force push detected on protected branch', {
            repoId: repo.id,
            branch,
            before: payload.before,
            after: payload.after,
          });
        }
      } catch (err) {
        logger.info('Branch protection check skipped in post-receive', {
          repoId: repo.id,
          branch,
          err: String(err),
        });
      }
    }

    // Fire webhooks (async, don't block response)
    const webhookPayload = {
      event,
      repository: {
        id: repo.id,
        name: repo.name,
        slug: repo.slug,
      },
      ref: payload.ref,
      refName,
      before: payload.before,
      after: payload.after,
      timestamp: new Date().toISOString(),
    };

    // Dispatch to matching webhooks
    for (const webhook of repo.webhooks) {
      if (webhook.events.includes(event) || webhook.events.includes('*')) {
        dispatchWebhook(webhook.id, webhook.url, webhook.secret, webhookPayload).catch((err) => {
          logger.error('Webhook delivery failed', { url: webhook.url }, err as Error);
        });
      }
    }

    // Invalidate repo file tree cache
    cacheInvalidate(`repo:${repo.id}:*`).catch(() => {});

    // Broadcast realtime event so frontends invalidate their query caches
    const room = `repo:${repo.team.org.slug}/${repo.team.slug}/${repo.slug}`;
    broadcastToRoom(room, { type: 'repo:pushed', repoId: repo.id, ref: refName });

    // Update any open PRs that involve this branch
    if (!isTag && !isDelete) {
      await prisma.pullRequest.updateMany({
        where: {
          repoId: repo.id,
          status: 'OPEN',
          OR: [{ sourceBranch: refName }, { targetBranch: refName }],
        },
        data: { updatedAt: new Date() },
      });
    }

    // Resolve pusher from first new commit's author email (reused for branch auto-link)
    let pusherId: string | null = null;

    // Auto-link commits to issues via commit message references
    if (!isTag && !isDelete) {
      try {
        const ISSUE_REF_RE = /(?:(closes?|fixes?)\s+)?[#^](?:([A-Z]+-)?(\d+))/gi;
        const recentCommits = await gitCmd.log(repo.diskPath!, payload.after, 50, 0);

        // Resolve pusher from latest commit author
        if (recentCommits.length > 0 && recentCommits[0].authorEmail) {
          const pusherUser = await prisma.user.findFirst({
            where: { email: recentCommits[0].authorEmail },
          });
          if (pusherUser) pusherId = pusherUser.id;
        }

        for (const commit of recentCommits) {
          const matches = [...commit.message.matchAll(ISSUE_REF_RE)];
          for (const match of matches) {
            const keyword = match[1]?.toLowerCase();
            const prefix = match[2]?.replace(/-$/, ''); // e.g. "AXM" from "AXM-"
            const issueNum = parseInt(match[3]);

            // Find issues in this repo's team's projects
            const teamProjects = await prisma.project.findMany({
              where: {
                team: { repos: { some: { id: repo.id } } },
                ...(prefix ? { prefix } : {}),
              },
              select: { id: true },
            });

            for (const project of teamProjects) {
              const issue = await prisma.issue.findUnique({
                where: { projectId_number: { projectId: project.id, number: issueNum } },
              });
              if (!issue) continue;

              const refType: CommitRefType = keyword?.startsWith('clos')
                ? CommitRefType.CLOSES
                : keyword?.startsWith('fix')
                  ? CommitRefType.FIXES
                  : CommitRefType.REFS;

              await prisma.issueCommit.upsert({
                where: { issueId_sha: { issueId: issue.id, sha: commit.sha } },
                create: {
                  issueId: issue.id,
                  repoId: repo.id,
                  sha: commit.sha,
                  message: commit.message.split('\n')[0],
                  authorName: commit.author,
                  authorEmail: commit.authorEmail ?? '',
                  committedAt: new Date(commit.date),
                  refType,
                },
                update: {},
              });

              // Auto-close if closes/fixes on default branch
              if ((refType === 'CLOSES' || refType === 'FIXES') && refName === repo.defaultBranch) {
                const doneColumn = await prisma.boardColumn.findFirst({
                  where: { projectId: project.id, name: { contains: 'done', mode: 'insensitive' } },
                });
                if (doneColumn && issue.columnId !== doneColumn.id) {
                  await prisma.issue.update({
                    where: { id: issue.id },
                    data: { columnId: doneColumn.id },
                  });
                }
              }
            }
          }

          // Execute smart commit directives only for new commits (skip already-processed)
          try {
            const alreadyProcessed = await prisma.issueCommit.findFirst({
              where: { sha: commit.sha, repoId: repo.id },
              select: { createdAt: true },
            });
            // If commit was already linked before this push (createdAt > 5s ago), skip smart commits
            const isNew =
              !alreadyProcessed || Date.now() - alreadyProcessed.createdAt.getTime() < 5000;
            if (isNew) {
              const commitUser = commit.authorEmail
                ? await prisma.user.findFirst({ where: { email: commit.authorEmail } })
                : null;
              await executeSmartCommit(commit.message, repo.id, commitUser?.id ?? null);
            }
          } catch (err) {
            logger.error(
              'smart commit execution error',
              { repoId: repo.id, sha: commit.sha },
              err as Error,
            );
          }
        }
      } catch (err) {
        logger.error('commit->issue linking error', { repoId: repo.id }, err as Error);
      }
    }

    // Auto-link branch to issue if branch name contains an issue key
    if (!isTag && !isDelete) {
      try {
        await autoLinkBranch(payload.ref, repo.id, pusherId);
      } catch (err) {
        logger.error('branch auto-link error', { repoId: repo.id }, err as Error);
      }
    }

    // Trigger CI/CD pipelines on push events
    if (event === 'push' && !isDelete) {
      triggerPipelineOnPush(repo.id, refName, payload.after).catch((err) => {
        logger.error('Pipeline trigger error', { repoId: repo.id, branch: refName }, err as Error);
      });
    }

    res.json({ ok: true, event, ref: refName });
  } catch (err) {
    next(err);
  }
});

async function autoLinkBranch(ref: string, repoId: string, pusherId: string | null): Promise<void> {
  if (!ref.startsWith('refs/heads/')) return;
  if (!pusherId) {
    logger.warn('branch auto-link skipped: could not resolve pusher', { repoId, ref });
    return;
  }

  const branchName = ref.replace('refs/heads/', '');
  const match = branchName.match(ISSUE_KEY_IN_BRANCH);
  if (!match) return;

  const issueKey = match[1];
  const keyMatch = issueKey.match(/^([A-Z]+)-(\d+)$/);
  if (!keyMatch) return;

  const [, prefix, numStr] = keyMatch;
  const issueNumber = parseInt(numStr, 10);

  // Scope to projects in the same team as the repo
  const issue = await prisma.issue.findFirst({
    where: {
      number: issueNumber,
      project: {
        prefix,
        team: { repos: { some: { id: repoId } } },
      },
    },
  });

  if (!issue) return;

  await prisma.issueBranch.upsert({
    where: {
      issueId_repoId_branchName: {
        issueId: issue.id,
        repoId,
        branchName,
      },
    },
    create: {
      issueId: issue.id,
      repoId,
      branchName,
      createdById: pusherId,
    },
    update: {},
  });
}

/**
 * Dispatch a webhook with HMAC-SHA256 signature and retry logic.
 * Logs delivery results to the WebhookDelivery table.
 * @param webhookId
 * @param url
 * @param secret
 * @param payload
 * @param retries
 */
export async function dispatchWebhook(
  webhookId: string,
  url: string,
  secret: string | null,
  payload: Record<string, unknown>,
  retries: number = 3,
): Promise<void> {
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Axiom-Event': payload.event as string,
    'User-Agent': 'Axiom-Webhooks/0.1.0',
  };

  if (secret) {
    const signature = crypto.createHmac('sha256', secret).update(body).digest('hex');
    headers['X-Axiom-Signature'] = `sha256=${signature}`;
  }

  const start = Date.now();
  let statusCode: number | null = null;
  let responseBody: string | null = null;
  let errorMessage: string | null = null;
  let success = false;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);

      const res = await fetch(url, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      });

      clearTimeout(timeout);
      statusCode = res.status;
      responseBody = await res.text().catch(() => null);

      if (res.ok) {
        success = true;
        break;
      }
      if (res.status < 500) break; // Client error — don't retry
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Unknown error';
    }

    // Exponential backoff: 1s, 2s, 4s
    if (attempt < retries - 1) {
      await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
    }
  }

  const duration = Date.now() - start;

  // Log delivery to database
  await prisma.webhookDelivery
    .create({
      data: {
        webhookId,
        event: (payload.event as string) ?? 'unknown',
        url,
        statusCode,
        success,
        duration,
        requestBody: body,
        responseBody: responseBody?.slice(0, 10_000) ?? null,
        error: errorMessage,
      },
    })
    .catch((err) => {
      logger.error('Failed to log webhook delivery', { webhookId }, err as Error);
    });
}

const SAFE_REPO_ID = /^[A-Za-z0-9_-]+$/;

/**
 * Generate the post-receive hook script for a repository. The script carries only the
 * repository id; the API URL and secret are read from the git process environment.
 * @param repoId - Repository id (cuid)
 * @returns POSIX sh script content
 * @throws {Error} when the id contains characters unsafe for a shell script
 */
export function generatePostReceiveHook(repoId: string): string {
  if (!SAFE_REPO_ID.test(repoId)) {
    throw new Error(`Refusing to write hook for unsafe repo id: ${repoId}`);
  }
  return `#!/bin/sh
# Installed by Axiom. Do not edit; rewritten on every deploy.
exec node "\${AXIOM_HOOK_ENTRY:-/app/dist/git/post-receive-hook.js}" "${repoId}"
`;
}

export default router;
