import { logger } from '../../utils/logger';

import type { GithubActor } from './github-actor';

export type GithubTransition =
  | 'pr_opened'
  | 'pr_reopened'
  | 'pr_ready_for_review'
  | 'pr_merged'
  | 'pr_closed'
  | 'reviewers_added'
  | 'review_added'
  | 'branch_created'
  | 'checks_failed'
  | 'checks_passed';

/** What one stored change did, told to every listener once the change is committed */
export type GithubEventOutcome = {
  repoLinkId: string;
  /** Empty when the link was gone by the time the change was reported: then nobody is told */
  projectId: string;
  event: string;
  action: string | null;
  source: 'webhook' | 'reconcile' | 'action';
  pullRequestId?: string;
  branchId?: string;
  headSha?: string;
  actor: GithubActor;
  /** The issues the changed branch, pull request or commits name now */
  linkedIssueIds: string[];
  /** The issues that stopped being named by this change (their development panel changed too) */
  removedIssueIds: string[];
  /** The linked issues named through a branch name or a PR title */
  drivingIssueIds: string[];
  transitions: GithubTransition[];
  payload: Record<string, unknown>;
};

type OutcomeListener = (outcome: GithubEventOutcome) => Promise<void>;
const listeners: OutcomeListener[] = [];

/**
 * Registers a listener for stored changes. Listeners run in registration order after the change
 * is committed. One that throws is logged (without the payload) and does not fail the delivery.
 * Realtime listeners only reach sockets of the process that stores the change: a delivery
 * retried by the worker does not broadcast.
 * @param listener Told each outcome
 * @returns A function that unregisters it again
 */
export function onGithubOutcome(listener: OutcomeListener): () => void {
  listeners.push(listener);
  return () => {
    const at = listeners.indexOf(listener);
    if (at >= 0) listeners.splice(at, 1);
  };
}

/**
 * Tells the listeners of an outcome. Nothing is told when the repository link is gone (no project).
 * @param outcome What was stored
 */
export async function reportOutcome(outcome: GithubEventOutcome): Promise<void> {
  if (!outcome.projectId) return;
  for (const listener of [...listeners]) {
    try {
      await listener(outcome);
    } catch (err) {
      logger.warn('github outcome listener failed', {
        repoLinkId: outcome.repoLinkId,
        event: outcome.event,
        action: outcome.action,
        error: err instanceof Error ? err.message : 'unknown',
      });
    }
  }
}
