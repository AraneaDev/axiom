// Turns what GitHub did into automation triggers. Imported by webhook-handlers.ts, so the API and
// the worker both run the rules of a stored change, whichever process stored it.
import type { GithubCheckRun, GithubPullRequest } from '@prisma/client';

import { prisma } from '../../config/database';
import { logger } from '../../utils/logger';
import { AUTOMATION_ISSUE_INCLUDE, evaluateRules } from '../automation/automation.service';
import type { AutomationContext, AutomationTrigger } from '../automation/automation.service';

import { isFailed, newestRuns } from './checks.service';
import { outsideGithubCallCount } from './github-client';
import { onGithubOutcome, type GithubEventOutcome, type GithubTransition } from './github-outcomes';
import { GITHUB_INTEGRATION_USER_ID } from './integration-user';

/** The trigger each transition sets off; a draft PR's opening fires when it becomes ready */
export const TRANSITION_TRIGGERS: Record<GithubTransition, AutomationTrigger> = {
  pr_opened: 'pr:opened',
  pr_reopened: 'pr:opened',
  pr_ready_for_review: 'pr:opened',
  pr_merged: 'pr:merged',
  pr_closed: 'pr:closed',
  reviewers_added: 'pr:review_requested',
  review_added: 'pr:review_submitted',
  checks_failed: 'checks:failed',
  checks_passed: 'checks:passed',
  branch_created: 'branch:created',
};

/** What a rule's templates see as `github`; every text in it is GitHub's, so plain text only */
export type GithubTriggerContext = {
  trigger: AutomationTrigger;
  repo: string;
  actorLogin: string;
  pr?: {
    number: number;
    title: string;
    url: string;
    state: string;
    draft: boolean;
    author: string;
    headRef: string;
    baseRef: string;
    headSha: string;
  };
  review?: { author: string; state: string; url: string };
  checks?: {
    headSha: string;
    /** Comma-separated */
    failedNames: string;
    failed: Array<{ name: string; failedStep: string | null; url: string }>;
  };
  branch?: { name: string; url: string };
};

/** What a comment guard is told about the comment an action wants to make */
export type CommentGuardInfo = {
  outcome: GithubEventOutcome;
  issueId: string;
  trigger: AutomationTrigger;
  /** The outcome comes from the first reconcile after the repository was linked */
  firstReconcile: boolean;
};
export type CommentGuard = (info: CommentGuardInfo) => boolean | Promise<boolean>;

const commentGuards: CommentGuard[] = [];

/**
 * Adds a guard every add_comment action of a GitHub trigger asks; the comment is made only when
 * all of them say true.
 * @param guard The guard
 * @returns A function that removes it again
 */
export function registerCommentGuard(guard: CommentGuard): () => void {
  commentGuards.push(guard);
  return () => {
    const at = commentGuards.indexOf(guard);
    if (at >= 0) commentGuards.splice(at, 1);
  };
}

// The first sync of a new link reports every PR already open: tickets may move, nobody is told
registerCommentGuard((info) => !info.firstReconcile);

async function allow(info: CommentGuardInfo): Promise<boolean> {
  for (const guard of [...commentGuards]) if (!(await guard(info))) return false;
  return true;
}

// `lastReconciledAt` is written when a run ends, so it is still null for the whole first run
async function isFirstReconcile(outcome: GithubEventOutcome): Promise<boolean> {
  if (outcome.source !== 'reconcile') return false;
  const link = await prisma.githubRepoLink.findUnique({
    where: { id: outcome.repoLinkId },
    select: { lastReconciledAt: true },
  });
  return link !== null && link.lastReconciledAt === null;
}

// The mapped user, when they are a member of the project's org; else the integration user
async function actorIdOf(outcome: GithubEventOutcome): Promise<string> {
  if (!outcome.actor.mapped) return GITHUB_INTEGRATION_USER_ID;
  const project = await prisma.project.findUnique({
    where: { id: outcome.projectId },
    select: { team: { select: { orgId: true } } },
  });
  if (!project) return GITHUB_INTEGRATION_USER_ID;
  const member = await prisma.orgMembership.findFirst({
    where: { userId: outcome.actor.userId, orgId: project.team.orgId },
    select: { id: true },
  });
  return member ? outcome.actor.userId : GITHUB_INTEGRATION_USER_ID;
}

const prContext = (pr: GithubPullRequest): NonNullable<GithubTriggerContext['pr']> => ({
  number: pr.number,
  title: pr.title,
  url: pr.htmlUrl,
  state: pr.state.toLowerCase(),
  draft: pr.draft,
  author: pr.authorLogin,
  headRef: pr.headRef,
  baseRef: pr.baseRef,
  headSha: pr.headSha,
});

// The context of one transition, or null when the row it is about is gone or it must not fire
async function contextOf(
  outcome: GithubEventOutcome,
  transition: GithubTransition,
  repo: { fullName: string; htmlUrl: string },
): Promise<GithubTriggerContext | null> {
  const trigger = TRANSITION_TRIGGERS[transition];
  const context: GithubTriggerContext = {
    trigger,
    repo: repo.fullName,
    actorLogin: outcome.actor.login,
  };
  const pr = outcome.pullRequestId
    ? await prisma.githubPullRequest.findUnique({ where: { id: outcome.pullRequestId } })
    : null;
  if (pr) {
    // A draft PR fires when it becomes ready, not when it is opened
    if (pr.draft && (transition === 'pr_opened' || transition === 'pr_reopened')) return null;
    context.pr = prContext(pr);
  }
  switch (transition) {
    case 'review_added': {
      if (!pr) return null;
      const review = await prisma.githubReview.findFirst({
        where: { pullRequestId: pr.id },
        orderBy: { submittedAt: 'desc' },
      });
      if (!review) return null;
      context.review = {
        author: review.authorLogin,
        state: review.state.toLowerCase(),
        url: `${pr.htmlUrl}#pullrequestreview-${review.id}`,
      };
      break;
    }
    case 'checks_failed':
    case 'checks_passed': {
      if (!outcome.headSha) return null;
      const runs: Array<Pick<GithubCheckRun, 'failedStep' | 'htmlUrl'> & CountedRun> =
        await prisma.githubCheckRun.findMany({
          where: { repoLinkId: outcome.repoLinkId, headSha: outcome.headSha },
        });
      const failed = newestRuns(runs)
        .filter((run) => isFailed(run.conclusion))
        .map((run) => ({ name: run.name, failedStep: run.failedStep, url: run.htmlUrl }));
      context.checks = {
        headSha: outcome.headSha,
        failedNames: failed.map((run) => run.name).join(', '),
        failed,
      };
      break;
    }
    case 'branch_created': {
      const branch = outcome.branchId
        ? await prisma.githubBranch.findUnique({ where: { id: outcome.branchId } })
        : null;
      if (!branch) return null;
      const path = branch.name.split('/').map(encodeURIComponent).join('/');
      context.branch = { name: branch.name, url: `${repo.htmlUrl}/tree/${path}` };
      break;
    }
    default:
      if (!pr) return null;
  }
  return context;
}

type CountedRun = {
  id: string;
  checkSuiteId: bigint | null;
  workflowRunId: string | null;
  appSlug: string;
  name: string;
  status: string;
  conclusion: string | null;
};

/**
 * Runs the rules of the transitions an outcome carries, for each issue the change drives. An
 * outcome without a transition fires nothing. A failing rule is logged (no payload) and skipped.
 * @param outcome What was stored
 */
export async function fireGithubTriggers(outcome: GithubEventOutcome): Promise<void> {
  if (outcome.transitions.length === 0 || outcome.drivingIssueIds.length === 0) return;
  // Runs inside a reconcile's call counter: the rules' own requests are not the run's budget
  await outsideGithubCallCount(async () => {
    const fail = (err: unknown, extra: Record<string, unknown>) =>
      logger.warn('github automation failed', {
        repoLinkId: outcome.repoLinkId,
        event: outcome.event,
        ...extra,
        error: err instanceof Error ? err.message : 'unknown',
      });
    let common: Awaited<ReturnType<typeof prepare>>;
    try {
      common = await prepare(outcome);
    } catch (err) {
      return fail(err, {});
    }
    if (!common) return;
    for (const transition of outcome.transitions) {
      const trigger = TRANSITION_TRIGGERS[transition];
      let github: GithubTriggerContext | null;
      try {
        github = await contextOf(outcome, transition, common.repo);
      } catch (err) {
        fail(err, { trigger });
        continue;
      }
      if (!github) continue;
      for (const issueId of outcome.drivingIssueIds) {
        try {
          const issue = await prisma.issue.findUnique({
            where: { id: issueId },
            include: AUTOMATION_ISSUE_INCLUDE,
          });
          if (!issue) continue;
          const info: CommentGuardInfo = {
            outcome,
            issueId,
            trigger,
            firstReconcile: common.firstReconcile,
          };
          await evaluateRules(issue.projectId, trigger, {
            issue: issue as unknown as AutomationContext['issue'],
            actorId: common.actorId,
            automationDepth: 0,
            github,
            commentGuard: () => allow(info),
          });
        } catch (err) {
          fail(err, { trigger, issueId });
        }
      }
    }
  });
}

async function prepare(outcome: GithubEventOutcome) {
  const repo = await prisma.githubRepoLink.findUnique({
    where: { id: outcome.repoLinkId },
    select: { fullName: true, htmlUrl: true },
  });
  if (!repo) return null;
  return {
    repo,
    actorId: await actorIdOf(outcome),
    firstReconcile: await isFirstReconcile(outcome),
  };
}

onGithubOutcome(fireGithubTriggers);
