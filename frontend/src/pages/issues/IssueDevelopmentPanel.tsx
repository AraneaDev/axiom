import { useQuery } from '@tanstack/react-query';
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  GitBranch,
  GitMerge,
  GitPullRequest,
} from 'lucide-react';
import { useId, useState } from 'react';

import {
  githubDevelopmentApi,
  githubRepoApi,
  githubRepoKey,
  issueDevelopmentKey,
  type GithubBranchView,
  type GithubCheckView,
  type GithubPerson,
  type GithubPullRequestView,
} from '@/api/github.api';
import { Badge } from '@/components/ui/Badge';
import { Card, CardHeader } from '@/components/ui/Card';
import { CheckStatusIcon } from '@/components/ui/CheckStatusIcon';
import { ErrorAlert } from '@/components/ui/ErrorAlert';
import { LogTail } from '@/components/ui/LogTail';
import { Spinner } from '@/components/ui/Spinner';
import { checkStateOf } from '@/lib/github-checks';
import { EXTERNAL_LINK, httpsHref } from '@/lib/github-links';

const PR_STATE_VARIANT = {
  open: 'success',
  draft: 'default',
  merged: 'primary',
  closed: 'danger',
} as const;

const REVIEW_VARIANT: Record<string, 'success' | 'danger' | 'default'> = {
  approved: 'success',
  changes_requested: 'danger',
};

/**
 * A GitHub link, or the plain text when the stored URL is not https. Text is never markup.
 * @param root0
 * @param root0.href
 * @param root0.children
 */
function ExternalText({ href, children }: { href: string; children: string }) {
  const safe = httpsHref(href);
  if (!safe) return <span>{children}</span>;
  return (
    <a
      href={safe}
      {...EXTERNAL_LINK}
      className="inline-flex items-center gap-1 text-primary hover:underline"
    >
      {children}
    </a>
  );
}

/**
 * The Axiom display name of a mapped person, else the GitHub login (with a hint for authors).
 * @param root0
 * @param root0.person
 * @param root0.hint
 */
function Person({ person, hint }: { person: GithubPerson; hint?: boolean }) {
  if (person.user) return <span className="text-text">{person.user.displayName}</span>;
  return (
    <span className="inline-flex items-center gap-1">
      <span className="text-text">{person.login}</span>
      {hint && <span className="text-[11px] text-text-tertiary">on GitHub</span>}
    </span>
  );
}

/**
 * Each reviewer's latest review state (reviews come oldest first), then the ones still asked.
 * @param pr
 */
function reviewersOf(pr: GithubPullRequestView) {
  const latest = new Map<string, { person: GithubPerson; state: string }>();
  for (const review of pr.reviews) {
    latest.set(review.author.login, { person: review.author, state: review.state });
  }
  const asked = pr.requestedReviewers
    .filter((p) => !latest.has(p.login))
    .map((person) => ({ person, state: 'requested' }));
  return [...latest.values(), ...asked];
}

function PullRequestRow({ pr }: { pr: GithubPullRequestView }) {
  const state = pr.draft && pr.state === 'open' ? 'draft' : pr.state;
  const reviewers = reviewersOf(pr);
  return (
    <li className="flex flex-col gap-1.5 px-5 py-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {pr.state === 'merged' ? (
          <GitMerge className="h-4 w-4 shrink-0 text-primary" />
        ) : (
          <GitPullRequest className="h-4 w-4 shrink-0 text-text-secondary" />
        )}
        <span className="font-medium">
          <ExternalText href={pr.url}>{`#${pr.number}`}</ExternalText>
        </span>
        <span className="min-w-0 break-words text-text">{pr.title}</span>
        <Badge variant={PR_STATE_VARIANT[state]} size="sm">
          {state}
        </Badge>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pl-6 text-xs text-text-secondary">
        <span className="inline-flex items-center gap-1">
          by <Person person={pr.author} hint />
        </span>
        <span className="inline-flex items-center gap-1 font-mono">
          {pr.headRef} <span className="text-text-tertiary">into</span> {pr.baseRef}
        </span>
        {reviewers.map(({ person, state: reviewState }) => (
          <span key={person.login} className="inline-flex items-center gap-1">
            <Person person={person} />
            <Badge variant={REVIEW_VARIANT[reviewState] ?? 'default'} size="sm">
              {reviewState.replace('_', ' ')}
            </Badge>
          </span>
        ))}
      </div>
    </li>
  );
}

function BranchRow({ branch }: { branch: GithubBranchView }) {
  return (
    <li className="flex items-center gap-2 px-5 py-2 text-sm">
      <GitBranch className="h-4 w-4 shrink-0 text-text-secondary" />
      <span className="font-mono">
        <ExternalText href={branch.url}>{branch.name}</ExternalText>
      </span>
      {branch.deleted && (
        <Badge size="sm" variant="outline">
          deleted
        </Badge>
      )}
    </li>
  );
}

function CheckRow({ check }: { check: GithubCheckView }) {
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const expandable = !!check.failedStep || !!check.logTail || check.logUnavailable;
  const state = checkStateOf(check.status, check.conclusion);
  const head = (
    <>
      <CheckStatusIcon status={check.status} conclusion={check.conclusion} />
      <span className="min-w-0 break-words text-left text-text">{check.name}</span>
      {check.pullRequests.length > 0 && (
        <span className="text-xs text-text-tertiary">
          {check.pullRequests.map((n) => `PR #${n}`).join(', ')}
        </span>
      )}
    </>
  );
  return (
    <li className="flex flex-col">
      {expandable ? (
        <button
          type="button"
          aria-expanded={open}
          aria-controls={open ? detailsId : undefined}
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center gap-2 px-5 py-2 text-sm hover:bg-surface-secondary"
        >
          {open ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-text-tertiary" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-text-tertiary" />
          )}
          {head}
        </button>
      ) : (
        <div className="flex items-center gap-2 px-5 py-2 pl-11 text-sm">{head}</div>
      )}
      {open && (
        <div id={detailsId} className="flex flex-col gap-2 px-5 pb-3 pl-11">
          {check.failedStep && (
            <p className="text-xs text-text-secondary">
              {state === 'failed' ? 'Failed step' : 'Step'}:{' '}
              <span className="font-medium text-text">{check.failedStep}</span>
            </p>
          )}
          <LogTail
            text={check.logTail}
            truncated={check.logTruncated}
            unavailable={check.logUnavailable}
          />
          {httpsHref(check.url) && (
            <a
              href={httpsHref(check.url)}
              {...EXTERNAL_LINK}
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              <ExternalLink className="h-3.5 w-3.5" /> View on GitHub
            </a>
          )}
        </div>
      )}
    </li>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="px-5 pt-3 pb-1 text-[11px] font-medium uppercase tracking-wider text-text-tertiary">
        {title}
      </h3>
      <ul className="divide-y divide-border-light">{children}</ul>
    </section>
  );
}

interface IssueDevelopmentPanelProps {
  projectId: string;
  /** The issue number from the URL */
  issueNumber: string;
  /** The issue id, which `issue:development-updated` names */
  issueId: string;
}

/**
 * The branches, pull requests and checks that name an issue. Shown only when the project is
 * linked to a GitHub repository. Everything from GitHub is plain text.
 * @param props - Panel props.
 * @param props.projectId - The issue's project.
 * @param props.issueNumber - The issue number.
 * @param props.issueId - The issue id.
 */
export function IssueDevelopmentPanel({
  projectId,
  issueNumber,
  issueId,
}: IssueDevelopmentPanelProps) {
  const repo = useQuery({
    queryKey: githubRepoKey(projectId),
    queryFn: () => githubRepoApi.get(projectId),
  });
  const linked = !!repo.data;
  const dev = useQuery({
    queryKey: issueDevelopmentKey(projectId, issueNumber, issueId),
    queryFn: () => githubDevelopmentApi.issue(projectId, parseInt(issueNumber)),
    enabled: linked,
    staleTime: 30_000,
  });

  if (!linked) return null;
  // The read left the panels out: this reader may not see them
  if (dev.data && !dev.data.development && !dev.data.checks) return null;

  const branches = dev.data?.development?.branches.items ?? [];
  const prs = dev.data?.development?.pullRequests.items ?? [];
  const checks = dev.data?.checks?.items ?? [];
  const empty = dev.data && !branches.length && !prs.length && !checks.length;

  return (
    <Card>
      <CardHeader>
        <h2 className="flex items-center gap-2 text-sm font-semibold text-text">
          <GitPullRequest className="h-4 w-4 text-text-secondary" />
          Development
        </h2>
      </CardHeader>
      {dev.isLoading && (
        <div className="flex justify-center p-5">
          <Spinner size="sm" />
        </div>
      )}
      {dev.error && (
        <div className="p-4">
          <ErrorAlert error={dev.error} fallback="Could not load the development panel" />
        </div>
      )}
      {empty && (
        <p className="px-5 py-4 text-sm text-text-secondary">
          No branches or pull requests name this issue yet. Put its key in a branch name or a pull
          request title.
        </p>
      )}
      {prs.length > 0 && (
        <Section title="Pull requests">
          {prs.map((pr) => (
            <PullRequestRow key={pr.number} pr={pr} />
          ))}
        </Section>
      )}
      {branches.length > 0 && (
        <Section title="Branches">
          {branches.map((b) => (
            <BranchRow key={b.name} branch={b} />
          ))}
        </Section>
      )}
      {checks.length > 0 && (
        <Section title="Checks">
          {checks.map((c) => (
            <CheckRow key={`${c.headSha}-${c.name}-${c.url}`} check={c} />
          ))}
        </Section>
      )}
    </Card>
  );
}
