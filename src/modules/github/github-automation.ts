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
  /** When the thing that happened happened on GitHub; null when that cannot be told */
  eventAt: Date | null;
  /** When the repository was linked: nothing older than this is news */
  linkedAt: Date;
  /** The pull request or branch the comment is about (the head commit alone when neither) */
  subjectKey: string;
  /** The head commit it is about, empty for a branch */
  headSha: string;
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

// What happened before the repository was linked may move tickets, but nobody is told of it
const isNews = (info: Pick<CommentGuardInfo, 'eventAt' | 'linkedAt'>): boolean =>
  info.eventAt !== null && info.eventAt >= info.linkedAt;
registerCommentGuard(isNews);

/**
 * Takes the one comment a trigger may make for an issue, a subject (pull request or branch) and a
 * head commit. The first caller gets true; every later one gets false, however many events,
 * redeliveries or rules ask.
 * @param issueId The issue
 * @param trigger The trigger
 * @param subjectKey The pull request or branch id
 * @param headSha The head commit
 * @returns Whether the comment may be made
 */
export async function claimCommentSlot(
  issueId: string,
  trigger: AutomationTrigger,
  subjectKey: string,
  headSha: string,
): Promise<boolean> {
  try {
    await prisma.githubAutomationMark.create({ data: { issueId, trigger, subjectKey, headSha } });
    return true;
  } catch (err) {
    if ((err as { code?: string }).code === 'P2002') return false;
    throw err;
  }
}

/**
 * Gives a slot back, when the comment it was taken for could not be written.
 * @param issueId The issue
 * @param trigger The trigger
 * @param subjectKey The pull request or branch id
 * @param headSha The head commit
 */
async function releaseCommentSlot(
  issueId: string,
  trigger: AutomationTrigger,
  subjectKey: string,
  headSha: string,
): Promise<void> {
  await prisma.githubAutomationMark.deleteMany({
    where: { issueId, trigger, subjectKey, headSha },
  });
}

const MARK_TTL_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Deletes the comment marks older than 90 days: nothing that old is redelivered or still noisy.
 * @returns How many it deleted
 */
export async function cleanupAutomationMarks(): Promise<number> {
  const { count } = await prisma.githubAutomationMark.deleteMany({
    where: { createdAt: { lt: new Date(Date.now() - MARK_TTL_MS) } },
  });
  return count;
}

// Runs the comment write when every guard agrees and the slot is free. The slot is claimed last,
// so a comment refused for another reason does not use it up, and it is given back when the
// write fails, so the next event on this head can still comment.
async function guardedComment(info: CommentGuardInfo, write: () => Promise<void>): Promise<void> {
  for (const guard of [...commentGuards]) if (!(await guard(info))) return;
  if (!(await claimCommentSlot(info.issueId, info.trigger, info.subjectKey, info.headSha))) return;
  try {
    await write();
  } catch (err) {
    await releaseCommentSlot(info.issueId, info.trigger, info.subjectKey, info.headSha).catch(
      () => undefined,
    );
    throw err;
  }
}

// Runs an email, a webhook call or a new issue only for news: the first sync and a re-link would
// otherwise send one per open PR. Moves and field changes are not held back by it.
async function guardedOutbound(
  info: Pick<CommentGuardInfo, 'eventAt' | 'linkedAt'>,
  write: () => Promise<void>,
): Promise<void> {
  if (isNews(info)) await write();
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

type CountedRun = {
  id: string;
  checkSuiteId: bigint | null;
  workflowRunId: string | null;
  appSlug: string;
  name: string;
  status: string;
  conclusion: string | null;
};

// The context of one transition and when it happened, or null when the row it is about is gone
// or it must not fire
async function contextOf(
  outcome: GithubEventOutcome,
  transition: GithubTransition,
  repo: { fullName: string; htmlUrl: string },
): Promise<{
  github: GithubTriggerContext;
  eventAt: Date | null;
  subjectKey: string;
  headSha: string;
} | null> {
  const trigger = TRANSITION_TRIGGERS[transition];
  // A change reconcile found has no GitHub sender: it is not "ghost", the account that is gone
  const actorLogin =
    outcome.source === 'reconcile' && !outcome.actor.mapped ? 'GitHub' : outcome.actor.login;
  const github: GithubTriggerContext = { trigger, repo: repo.fullName, actorLogin };
  let eventAt: Date | null = null;
  const pr = outcome.pullRequestId
    ? await prisma.githubPullRequest.findUnique({ where: { id: outcome.pullRequestId } })
    : null;
  if (pr) {
    // A draft PR fires when it becomes ready, not when it is opened
    if (pr.draft && (transition === 'pr_opened' || transition === 'pr_reopened')) return null;
    github.pr = prContext(pr);
  }
  switch (transition) {
    case 'pr_opened':
      eventAt = pr?.openedAt ?? null;
      break;
    // These happened when the PR was last updated: it is not the time it was first opened
    case 'pr_reopened':
    case 'pr_ready_for_review':
      eventAt = pr?.githubUpdatedAt ?? null;
      break;
    case 'pr_merged':
      eventAt = pr?.mergedAt ?? pr?.githubUpdatedAt ?? null;
      break;
    case 'pr_closed':
      eventAt = pr?.closedAt ?? pr?.githubUpdatedAt ?? null;
      break;
    case 'reviewers_added':
      // Only a webhook that says reviewers were requested, or a request Axiom made itself, dates
      // it now; any other event that carries the request (a first store, a merge, an edit) saw
      // requests as old as the PR
      eventAt =
        outcome.source === 'action' ||
        (outcome.source === 'webhook' && outcome.action === 'review_requested')
          ? new Date()
          : (pr?.openedAt ?? null);
      break;
    case 'review_added': {
      if (!pr) return null;
      const reviewId = (outcome.payload.review as { id?: unknown } | undefined)?.id;
      const named =
        typeof reviewId === 'number' || typeof reviewId === 'string'
          ? await prisma.githubReview.findFirst({
              where: { id: String(reviewId), pullRequestId: pr.id },
            })
          : null;
      const review =
        named ??
        (await prisma.githubReview.findFirst({
          where: { pullRequestId: pr.id },
          orderBy: { submittedAt: 'desc' },
        }));
      if (!review) return null;
      github.review = {
        author: review.authorLogin,
        state: review.state.toLowerCase(),
        url: `${pr.htmlUrl}#pullrequestreview-${review.id}`,
      };
      eventAt = review.submittedAt;
      break;
    }
    case 'checks_failed':
    case 'checks_passed': {
      if (!outcome.headSha) return null;
      const runs: Array<Pick<GithubCheckRun, 'failedStep' | 'htmlUrl'> & CountedRun> =
        await prisma.githubCheckRun.findMany({
          where: { repoLinkId: outcome.repoLinkId, headSha: outcome.headSha },
        });
      const counted = newestRuns(runs);
      const failed = counted
        .filter((run) => isFailed(run.conclusion))
        .map((run) => ({ name: run.name, failedStep: run.failedStep, url: run.htmlUrl }));
      github.checks = {
        headSha: outcome.headSha,
        failedNames: failed.map((run) => run.name).join(', '),
        failed,
      };
      const times = (
        await prisma.githubCheckRun.findMany({
          // A failure is dated by the runs that failed, a pass by all of them
          where: {
            id: {
              in: (transition === 'checks_failed'
                ? counted.filter((run) => isFailed(run.conclusion))
                : counted
              ).map((run) => run.id),
            },
          },
          select: { completedAt: true, githubUpdatedAt: true },
        })
      ).map((run) => (run.completedAt ?? run.githubUpdatedAt).getTime());
      eventAt = times.length ? new Date(Math.max(...times)) : null;
      break;
    }
    case 'branch_created': {
      const branch = outcome.branchId
        ? await prisma.githubBranch.findUnique({ where: { id: outcome.branchId } })
        : null;
      if (!branch) return null;
      const path = branch.name.split('/').map(encodeURIComponent).join('/');
      github.branch = { name: branch.name, url: `${repo.htmlUrl}/tree/${path}` };
      // The push time; else the row's, which is the event's own time only when a webhook made it
      eventAt = branch.lastPushedAt ?? (outcome.source === 'reconcile' ? null : branch.createdAt);
      break;
    }
    default:
      if (!pr) return null;
  }
  const subjectKey = pr?.id ?? outcome.pullRequestId ?? outcome.branchId ?? outcome.headSha ?? '';
  // Checks belong to the head they ran on, which the PR may have left since
  const headSha =
    (transition === 'checks_failed' || transition === 'checks_passed'
      ? github.checks?.headSha
      : github.pr?.headSha) ?? '';
  return { github, eventAt, subjectKey, headSha };
}

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
      let built: Awaited<ReturnType<typeof contextOf>>;
      try {
        built = await contextOf(outcome, transition, common.repo);
      } catch (err) {
        fail(err, { trigger });
        continue;
      }
      if (!built) continue;
      for (const issueId of outcome.drivingIssueIds) {
        try {
          const issue = await prisma.issue.findUnique({
            where: { id: issueId },
            include: AUTOMATION_ISSUE_INCLUDE,
          });
          // An issue that moved to another project is no business of this repository's project
          if (!issue || issue.projectId !== outcome.projectId) continue;
          // The PR this issue is linked to, when several open PRs share the head
          const own = outcome.pullRequestIdByIssue?.[issueId];
          const forIssue =
            own && own !== outcome.pullRequestId
              ? await contextOf({ ...outcome, pullRequestId: own }, transition, common.repo)
              : built;
          if (!forIssue) continue;
          const info: CommentGuardInfo = {
            outcome,
            issueId,
            trigger,
            eventAt: forIssue.eventAt,
            linkedAt: common.repo.createdAt,
            subjectKey: forIssue.subjectKey,
            headSha: forIssue.headSha,
          };
          await evaluateRules(outcome.projectId, trigger, {
            issue: issue as unknown as AutomationContext['issue'],
            actorId: common.actorId,
            automationDepth: 0,
            github: forIssue.github,
            commentGuard: (write) => guardedComment(info, write),
            outboundGuard: (write) => guardedOutbound(info, write),
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
    select: { fullName: true, htmlUrl: true, createdAt: true },
  });
  if (!repo) return null;
  return { repo, actorId: await actorIdOf(outcome) };
}

onGithubOutcome(fireGithubTriggers);
