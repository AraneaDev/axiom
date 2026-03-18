import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  GitMerge,
  XCircle,
  Check,
  X,
  ChevronDown,
  GitCommitHorizontal,
  GitBranchPlus,
  ShieldCheck,
  ShieldX,
  CircleDot,
  CheckCircle2,
  XCircle as XCircleIcon,
  AlertCircle,
  ExternalLink,
  Users,
  Loader2,
  Columns2,
  Rows3,
  ListChecks,
} from 'lucide-react';
import { useState, useCallback } from 'react';
import { useParams } from 'react-router';

import { orgsApi } from '@/api/orgs.api';
import { reposApi } from '@/api/repos.api';
import type { CommitInfo } from '@/api/repos.api';
import { statusChecksApi } from '@/api/status-checks.api';
import type { StatusCheck, CodeOwnerStatus } from '@/api/status-checks.api';
import { teamsApi } from '@/api/teams.api';
import { MarkdownEditor } from '@/components/editor/MarkdownEditor';
import { MarkdownRenderer } from '@/components/editor/MarkdownRenderer';
import { SuggestionBlock, hasSuggestion } from '@/components/SuggestionBlock';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Dropdown, DropdownItem } from '@/components/ui/Dropdown';
import { Spinner, PageLoader } from '@/components/ui/Spinner';
import { formatRelative } from '@/lib/utils';

const STRATEGY_LABELS: Record<string, { label: string; icon: React.ReactNode }> = {
  merge: {
    label: 'Merge commit',
    icon: <GitMerge className="h-4 w-4" />,
  },
  squash: {
    label: 'Squash and merge',
    icon: <GitCommitHorizontal className="h-4 w-4" />,
  },
  rebase: {
    label: 'Rebase and merge',
    icon: <GitBranchPlus className="h-4 w-4" />,
  },
};

const STATUS_BADGE: Record<string, 'primary' | 'success' | 'default'> = {
  OPEN: 'primary',
  MERGED: 'success',
  CLOSED: 'default',
};

/**
 *
 */
export default function PRDetail() {
  const { org, team: teamSlug, repo: repoSlug, number: prNum } = useParams();
  const queryClient = useQueryClient();
  const [commentBody, setCommentBody] = useState('');
  const [mergeStrategy, setMergeStrategy] = useState('');
  const [diffView, setDiffView] = useState<'unified' | 'split'>('unified');
  const [selectedSuggestions, setSelectedSuggestions] = useState<Set<string>>(new Set());
  const [applyingComment, setApplyingComment] = useState<string | null>(null);

  const toggleSuggestion = useCallback((commentId: string) => {
    setSelectedSuggestions((prev) => {
      const next = new Set(prev);
      if (next.has(commentId)) next.delete(commentId);
      else next.add(commentId);
      return next;
    });
  }, []);

  const { data: orgs } = useQuery({ queryKey: ['orgs'], queryFn: orgsApi.list });
  const currentOrg = orgs?.find((o) => o.slug === org);
  const { data: teams } = useQuery({
    queryKey: ['teams', currentOrg?.id],
    queryFn: () => teamsApi.listByOrg(currentOrg!.id),
    enabled: !!currentOrg?.id,
  });
  const currentTeam = teams?.find((t) => t.slug === teamSlug);
  const { data: repos } = useQuery({
    queryKey: ['repos', currentTeam?.id],
    queryFn: () => reposApi.listByTeam(currentTeam!.id),
    enabled: !!currentTeam?.id,
  });
  const currentRepo = repos?.find((r) => r.slug === repoSlug);
  const prNumber = parseInt(prNum!);

  const { data: pr, isLoading } = useQuery({
    queryKey: ['pr', currentRepo?.id, prNumber],
    queryFn: () => reposApi.getPR(currentRepo!.id, prNumber),
    enabled: !!currentRepo?.id,
  });

  const { data: mergeChecks } = useQuery({
    queryKey: ['mergeChecks', currentRepo?.id, prNumber],
    queryFn: () => reposApi.getMergeChecks(currentRepo!.id, prNumber),
    enabled: !!currentRepo?.id,
  });

  // Set initial strategy from repo default once merge checks load
  if (mergeChecks && mergeStrategy === '') {
    setMergeStrategy(mergeChecks.defaultStrategy.toLowerCase());
  }

  const { data: diff } = useQuery({
    queryKey: ['prDiff', currentRepo?.id, prNumber],
    queryFn: () => reposApi.getPRDiff(currentRepo!.id, prNumber),
    enabled: !!currentRepo?.id,
  });

  const { data: commits } = useQuery({
    queryKey: ['prCommits', currentRepo?.id, prNumber],
    queryFn: () => reposApi.getPRCommits(currentRepo!.id, prNumber),
    enabled: !!currentRepo?.id,
  });

  const { data: prStatuses } = useQuery({
    queryKey: ['prStatuses', currentRepo?.id, prNumber],
    queryFn: () => statusChecksApi.getPRStatuses(currentRepo!.id, prNumber),
    enabled: !!currentRepo?.id && pr?.status === 'OPEN',
  });

  const { data: codeOwners } = useQuery({
    queryKey: ['prCodeOwners', currentRepo?.id, prNumber],
    queryFn: () => statusChecksApi.getPRCodeOwners(currentRepo!.id, prNumber),
    enabled: !!currentRepo?.id,
  });

  const mergeMutation = useMutation({
    mutationFn: () => reposApi.mergePR(currentRepo!.id, prNumber, mergeStrategy),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['pr', currentRepo?.id, prNumber] }),
  });

  const closeMutation = useMutation({
    mutationFn: () => reposApi.closePR(currentRepo!.id, prNumber),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['pr', currentRepo?.id, prNumber] }),
  });

  const reviewMutation = useMutation({
    mutationFn: (data: { status: string; body?: string }) =>
      reposApi.submitReview(currentRepo!.id, prNumber, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['pr', currentRepo?.id, prNumber] }),
  });

  const commentMutation = useMutation({
    mutationFn: () => reposApi.addPRComment(currentRepo!.id, prNumber, { body: commentBody }),
    onSuccess: () => {
      setCommentBody('');
      queryClient.invalidateQueries({ queryKey: ['pr', currentRepo?.id, prNumber] });
    },
  });

  const applySuggestionMutation = useMutation({
    mutationFn: (commentId: string) =>
      reposApi.applySuggestion(currentRepo!.id, prNumber, commentId),
    onMutate: (commentId) => setApplyingComment(commentId),
    onSettled: () => setApplyingComment(null),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pr', currentRepo?.id, prNumber] });
      queryClient.invalidateQueries({ queryKey: ['prDiff', currentRepo?.id, prNumber] });
      queryClient.invalidateQueries({ queryKey: ['prCommits', currentRepo?.id, prNumber] });
    },
  });

  const batchApplyMutation = useMutation({
    mutationFn: () =>
      reposApi.batchApplySuggestions(currentRepo!.id, prNumber, [...selectedSuggestions]),
    onSuccess: () => {
      setSelectedSuggestions(new Set());
      queryClient.invalidateQueries({ queryKey: ['pr', currentRepo?.id, prNumber] });
      queryClient.invalidateQueries({ queryKey: ['prDiff', currentRepo?.id, prNumber] });
      queryClient.invalidateQueries({ queryKey: ['prCommits', currentRepo?.id, prNumber] });
    },
  });

  if (isLoading || !pr) return <PageLoader />;

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <h1 className="text-xl font-bold">{pr.title}</h1>
          <Badge variant={STATUS_BADGE[pr.status]}>{pr.status}</Badge>
        </div>
        <p className="text-sm text-text-secondary">
          #{pr.number} &middot;{' '}
          <code className="bg-surface-secondary px-1.5 py-0.5 rounded text-xs">
            {pr.sourceBranch}
          </code>
          {' → '}
          <code className="bg-surface-secondary px-1.5 py-0.5 rounded text-xs">
            {pr.targetBranch}
          </code>
          {' &middot; '}
          {formatRelative(pr.createdAt)}
        </p>
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Main content */}
        <div className="col-span-2 space-y-6">
          {/* Description */}
          {pr.body && (
            <div className="rounded-lg border border-border bg-surface p-4">
              <MarkdownRenderer content={pr.body} className="text-sm" />
            </div>
          )}

          {/* Commits */}
          {commits && commits.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold mb-2">Commits ({commits.length})</h2>
              <div className="rounded-lg border border-border bg-surface divide-y divide-border">
                {commits.map((c: CommitInfo) => (
                  <div key={c.sha} className="flex items-center gap-3 px-4 py-2">
                    <code className="text-xs text-text-secondary font-mono">{c.shortSha}</code>
                    <span className="text-sm flex-1 truncate">{c.message}</span>
                    <span className="text-xs text-text-secondary">{c.author}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Diff stats */}
          {diff?.stats && diff.stats.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold mb-2">Changed Files ({diff.stats.length})</h2>
              <div className="rounded-lg border border-border bg-surface divide-y divide-border">
                {diff.stats.map((s: { file: string; additions: number; deletions: number }) => (
                  <div key={s.file} className="flex items-center gap-3 px-4 py-2 text-sm">
                    <span className="flex-1 font-mono text-xs truncate">{s.file}</span>
                    <span className="text-success text-xs">+{s.additions}</span>
                    <span className="text-danger text-xs">-{s.deletions}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Diff content */}
          {diff?.diff && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-sm font-semibold">Diff</h2>
                <div className="flex items-center rounded-lg border border-border bg-surface overflow-hidden">
                  <Button
                    size="sm"
                    variant={diffView === 'unified' ? 'primary' : 'ghost'}
                    className="rounded-none border-0"
                    onClick={() => setDiffView('unified')}
                  >
                    <Rows3 className="h-3.5 w-3.5" /> Unified
                  </Button>
                  <Button
                    size="sm"
                    variant={diffView === 'split' ? 'primary' : 'ghost'}
                    className="rounded-none border-0"
                    onClick={() => setDiffView('split')}
                  >
                    <Columns2 className="h-3.5 w-3.5" /> Split
                  </Button>
                </div>
              </div>
              {diffView === 'unified' ? (
                <pre className="rounded-lg border border-border bg-surface p-4 text-xs font-mono overflow-x-auto max-h-[600px] overflow-y-auto">
                  {diff.diff.split('\n').map((line: string, i: number) => (
                    <div
                      key={i}
                      className={
                        line.startsWith('+') && !line.startsWith('+++')
                          ? 'text-success bg-success-light'
                          : line.startsWith('-') && !line.startsWith('---')
                            ? 'text-danger bg-danger-light'
                            : line.startsWith('@@')
                              ? 'text-primary bg-primary-light'
                              : ''
                      }
                    >
                      {line}
                    </div>
                  ))}
                </pre>
              ) : (
                <SplitDiffView rawDiff={diff.diff} />
              )}
            </div>
          )}

          {/* Reviews */}
          {pr.reviews && pr.reviews.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold mb-2">Reviews</h2>
              <div className="space-y-2">
                {pr.reviews.map(
                  (r: { id: string; status: string; body?: string; createdAt: string }) => (
                    <div
                      key={r.id}
                      className="rounded-lg border border-border bg-surface p-3 flex items-start gap-3"
                    >
                      <Badge
                        variant={
                          r.status === 'APPROVED'
                            ? 'success'
                            : r.status === 'CHANGES_REQUESTED'
                              ? 'danger'
                              : 'default'
                        }
                      >
                        {r.status === 'APPROVED'
                          ? 'Approved'
                          : r.status === 'CHANGES_REQUESTED'
                            ? 'Changes requested'
                            : 'Commented'}
                      </Badge>
                      {r.body && <p className="text-sm flex-1">{r.body}</p>}
                      <span className="text-xs text-text-secondary">
                        {formatRelative(r.createdAt)}
                      </span>
                    </div>
                  ),
                )}
              </div>
            </div>
          )}

          {/* Comments */}
          {pr.comments && pr.comments.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-sm font-semibold">Comments ({pr.comments.length})</h2>
                {selectedSuggestions.size > 0 && pr.status === 'OPEN' && (
                  <Button
                    size="sm"
                    disabled={batchApplyMutation.isPending}
                    onClick={() => batchApplyMutation.mutate()}
                  >
                    {batchApplyMutation.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <ListChecks className="h-3.5 w-3.5" />
                    )}
                    Apply {selectedSuggestions.size} suggestion
                    {selectedSuggestions.size !== 1 ? 's' : ''}
                  </Button>
                )}
              </div>
              <div className="space-y-2">
                {pr.comments.map(
                  (c: {
                    id: string;
                    filePath?: string;
                    line?: number;
                    body: string;
                    createdAt: string;
                  }) => (
                    <div key={c.id} className="rounded-lg border border-border bg-surface p-3">
                      {c.filePath && (
                        <p className="text-xs font-mono text-text-secondary mb-1">
                          {c.filePath}:{c.line}
                        </p>
                      )}
                      <MarkdownRenderer content={c.body} className="text-sm" />
                      {pr.status === 'OPEN' && hasSuggestion(c.body) && (
                        <SuggestionBlock
                          commentId={c.id}
                          body={c.body}
                          isApplying={applyingComment === c.id}
                          isSelected={selectedSuggestions.has(c.id)}
                          onApply={(id) => applySuggestionMutation.mutate(id)}
                          onToggleSelect={toggleSuggestion}
                        />
                      )}
                      <p className="text-xs text-text-secondary mt-1">
                        {formatRelative(c.createdAt)}
                      </p>
                    </div>
                  ),
                )}
              </div>
            </div>
          )}

          {/* Add comment */}
          {pr.status === 'OPEN' && (
            <div className="space-y-2">
              <MarkdownEditor
                value={commentBody}
                onChange={setCommentBody}
                placeholder="Leave a comment..."
                compact
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={!commentBody.trim() || commentMutation.isPending}
                  onClick={() => commentMutation.mutate()}
                >
                  {commentMutation.isPending ? (
                    <Spinner className="h-4 w-4" />
                  ) : (
                    <>
                      <GitCommitHorizontal className="h-4 w-4" /> Comment
                    </>
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => reviewMutation.mutate({ status: 'APPROVED', body: 'LGTM' })}
                >
                  <Check className="h-4 w-4" /> Approve
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    reviewMutation.mutate({
                      status: 'CHANGES_REQUESTED',
                      body: 'Please address feedback',
                    })
                  }
                >
                  <X className="h-4 w-4" /> Request changes
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
            <div>
              <p className="text-xs text-text-secondary uppercase font-semibold mb-1">
                Merge status
              </p>
              {pr.status === 'OPEN' ? (
                pr.mergeable === true ? (
                  <Badge variant="success">No conflicts</Badge>
                ) : pr.mergeable === false ? (
                  <Badge variant="danger">Has conflicts</Badge>
                ) : (
                  <Badge>Unknown</Badge>
                )
              ) : (
                <Badge variant={pr.status === 'MERGED' ? 'success' : 'default'}>
                  {pr.status}
                  {pr.status === 'MERGED' && pr.mergeStrategy
                    ? ` (${pr.mergeStrategy.toLowerCase()})`
                    : ''}
                </Badge>
              )}
            </div>

            {/* Merge checks */}
            {pr.status === 'OPEN' && mergeChecks && (
              <div className="space-y-2">
                <p className="text-xs text-text-secondary uppercase font-semibold">Merge checks</p>
                <div className="flex items-center gap-2 text-sm">
                  {mergeChecks.reviewsMet ? (
                    <ShieldCheck className="h-4 w-4 text-success" />
                  ) : (
                    <ShieldX className="h-4 w-4 text-danger" />
                  )}
                  <span className={mergeChecks.reviewsMet ? 'text-success' : 'text-danger'}>
                    {mergeChecks.approvedReviews} of {mergeChecks.requiredReviews} required
                    review(s)
                  </span>
                </div>
                {mergeChecks.requireCI && (
                  <div className="flex items-center gap-2 text-sm">
                    {mergeChecks.ciPassed ? (
                      <Check className="h-4 w-4 text-success" />
                    ) : (
                      <X className="h-4 w-4 text-danger" />
                    )}
                    <span className={mergeChecks.ciPassed ? 'text-success' : 'text-danger'}>
                      CI checks {mergeChecks.ciPassed ? 'passed' : 'required'}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Status checks */}
            {pr.status === 'OPEN' && prStatuses && prStatuses.statuses.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <p className="text-xs text-text-secondary uppercase font-semibold">
                    Status checks
                  </p>
                  <Badge
                    variant={
                      prStatuses.combined === 'success'
                        ? 'success'
                        : prStatuses.combined === 'failure'
                          ? 'danger'
                          : 'default'
                    }
                  >
                    {prStatuses.combined}
                  </Badge>
                </div>
                <div className="space-y-1">
                  {prStatuses.statuses.map((status: StatusCheck) => (
                    <div key={status.id} className="flex items-center gap-2 text-sm">
                      {status.state === 'SUCCESS' ? (
                        <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
                      ) : status.state === 'FAILURE' ? (
                        <XCircleIcon className="h-4 w-4 text-danger shrink-0" />
                      ) : status.state === 'ERROR' ? (
                        <AlertCircle className="h-4 w-4 text-danger shrink-0" />
                      ) : (
                        <Loader2 className="h-4 w-4 text-warning animate-spin shrink-0" />
                      )}
                      <span className="flex-1 truncate">{status.context}</span>
                      {status.targetUrl && (
                        <a
                          href={status.targetUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:underline"
                          title="View details"
                        >
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                  ))}
                  {prStatuses.statuses.some((s: StatusCheck) => s.description) && (
                    <div className="mt-1 space-y-1">
                      {prStatuses.statuses
                        .filter((s: StatusCheck) => s.description)
                        .map((s: StatusCheck) => (
                          <p key={s.id} className="text-xs text-text-tertiary">
                            {s.context}: {s.description}
                          </p>
                        ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {pr.status === 'OPEN' && (
              <>
                {/* Merge strategy split button */}
                <div className="flex w-full">
                  <Button
                    className="flex-1 rounded-r-none"
                    disabled={
                      !pr.mergeable ||
                      mergeMutation.isPending ||
                      (mergeChecks != null && !mergeChecks.canMerge)
                    }
                    onClick={() => mergeMutation.mutate()}
                  >
                    {mergeMutation.isPending ? (
                      <Spinner className="h-4 w-4" />
                    ) : (
                      <>
                        {STRATEGY_LABELS[mergeStrategy || 'merge']?.icon}
                        {STRATEGY_LABELS[mergeStrategy || 'merge']?.label ?? 'Merge'}
                      </>
                    )}
                  </Button>
                  <Dropdown
                    align="right"
                    trigger={
                      <Button
                        className="rounded-l-none border-l border-l-primary-hover px-2"
                        disabled={!pr.mergeable || (mergeChecks != null && !mergeChecks.canMerge)}
                      >
                        <ChevronDown className="h-4 w-4" />
                      </Button>
                    }
                  >
                    <DropdownItem onClick={() => setMergeStrategy('merge')}>
                      <GitMerge className="h-4 w-4" /> Merge commit
                    </DropdownItem>
                    <DropdownItem onClick={() => setMergeStrategy('squash')}>
                      <GitCommitHorizontal className="h-4 w-4" /> Squash and merge
                    </DropdownItem>
                    <DropdownItem onClick={() => setMergeStrategy('rebase')}>
                      <GitBranchPlus className="h-4 w-4" /> Rebase and merge
                    </DropdownItem>
                  </Dropdown>
                </div>
                {mergeChecks && !mergeChecks.canMerge && (
                  <p className="text-xs text-danger">
                    Merge requirements not met. Check review and CI status above.
                  </p>
                )}
                {mergeMutation.isError && (
                  <p className="text-xs text-danger">
                    {mergeMutation.error instanceof Error
                      ? mergeMutation.error.message
                      : 'Merge failed'}
                  </p>
                )}
                <Button variant="ghost" className="w-full" onClick={() => closeMutation.mutate()}>
                  <XCircle className="h-4 w-4" /> Close PR
                </Button>
              </>
            )}
          </div>

          {/* Code Owners */}
          {codeOwners && codeOwners.owners.length > 0 && (
            <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-text-secondary" />
                <p className="text-xs text-text-secondary uppercase font-semibold">Code Owners</p>
                <Badge variant={codeOwners.allApproved ? 'success' : 'default'}>
                  {codeOwners.allApproved ? 'All approved' : 'Pending'}
                </Badge>
              </div>
              <div className="space-y-1">
                {codeOwners.owners.map((owner: CodeOwnerStatus) => (
                  <div key={owner.owner} className="flex items-center gap-2 text-sm">
                    {owner.approved ? (
                      <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
                    ) : owner.reviewStatus === 'CHANGES_REQUESTED' ? (
                      <XCircleIcon className="h-4 w-4 text-danger shrink-0" />
                    ) : (
                      <CircleDot className="h-4 w-4 text-text-tertiary shrink-0" />
                    )}
                    <span className="flex-1">{owner.owner}</span>
                    <span className="text-xs text-text-tertiary">
                      {owner.approved
                        ? 'Approved'
                        : owner.reviewStatus
                          ? owner.reviewStatus.toLowerCase().replace('_', ' ')
                          : 'Awaiting review'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-lg border border-border bg-surface p-4">
            <p className="text-xs text-text-secondary uppercase font-semibold mb-1">Branches</p>
            <p className="text-sm">
              <code className="bg-surface-secondary px-1 rounded">{pr.sourceBranch}</code>
            </p>
            <p className="text-xs text-text-secondary my-1">into</p>
            <p className="text-sm">
              <code className="bg-surface-secondary px-1 rounded">{pr.targetBranch}</code>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Split Diff View ────────────────────────────────────────

interface SplitLine {
  left: { num: number | null; content: string; type: 'same' | 'del' | 'empty' };
  right: { num: number | null; content: string; type: 'same' | 'add' | 'empty' };
}

function parseDiffToSplit(raw: string): { file: string; lines: SplitLine[] }[] {
  const files: { file: string; lines: SplitLine[] }[] = [];
  const chunks = raw.split(/^diff --git /m).filter(Boolean);

  for (const chunk of chunks) {
    const linesRaw = chunk.split('\n');
    // Extract filename from the first line (a/path b/path)
    const headerMatch = linesRaw[0]?.match(/a\/(.+?) b\//);
    const file = headerMatch?.[1] ?? 'unknown';
    const splitLines: SplitLine[] = [];

    let leftNum = 0;
    let rightNum = 0;

    for (const line of linesRaw) {
      if (line.startsWith('@@')) {
        const hunkMatch = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
        if (hunkMatch) {
          leftNum = parseInt(hunkMatch[1], 10) - 1;
          rightNum = parseInt(hunkMatch[2], 10) - 1;
        }
        splitLines.push({
          left: { num: null, content: line, type: 'same' },
          right: { num: null, content: line, type: 'same' },
        });
        continue;
      }
      if (
        line.startsWith('---') ||
        line.startsWith('+++') ||
        line.startsWith('index ') ||
        line.startsWith('new file') ||
        line.startsWith('deleted file')
      ) {
        continue;
      }
      if (line.startsWith('-')) {
        leftNum++;
        splitLines.push({
          left: { num: leftNum, content: line.slice(1), type: 'del' },
          right: { num: null, content: '', type: 'empty' },
        });
      } else if (line.startsWith('+')) {
        rightNum++;
        splitLines.push({
          left: { num: null, content: '', type: 'empty' },
          right: { num: rightNum, content: line.slice(1), type: 'add' },
        });
      } else if (line.length > 0 || line === '') {
        leftNum++;
        rightNum++;
        splitLines.push({
          left: {
            num: leftNum,
            content: line.startsWith(' ') ? line.slice(1) : line,
            type: 'same',
          },
          right: {
            num: rightNum,
            content: line.startsWith(' ') ? line.slice(1) : line,
            type: 'same',
          },
        });
      }
    }
    if (splitLines.length > 0) {
      files.push({ file, lines: splitLines });
    }
  }
  return files;
}

function SplitDiffView({ rawDiff }: { rawDiff: string }) {
  const files = parseDiffToSplit(rawDiff);

  const bgClass = (type: string) =>
    type === 'del'
      ? 'bg-danger-light text-danger'
      : type === 'add'
        ? 'bg-success-light text-success'
        : type === 'empty'
          ? 'bg-surface-secondary'
          : '';

  return (
    <div className="space-y-4">
      {files.map((f) => (
        <div key={f.file} className="rounded-lg border border-border overflow-hidden">
          <div className="bg-surface-secondary px-3 py-1.5 text-xs font-mono text-text-secondary border-b border-border">
            {f.file}
          </div>
          <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
            <table className="w-full text-xs font-mono border-collapse">
              <tbody>
                {f.lines.map((row, i) => (
                  <tr key={i}>
                    <td className="w-10 text-right text-text-tertiary select-none px-1 border-r border-border bg-surface-secondary">
                      {row.left.num ?? ''}
                    </td>
                    <td className={`w-1/2 px-2 py-0 whitespace-pre ${bgClass(row.left.type)}`}>
                      {row.left.content}
                    </td>
                    <td className="w-10 text-right text-text-tertiary select-none px-1 border-r border-l border-border bg-surface-secondary">
                      {row.right.num ?? ''}
                    </td>
                    <td className={`w-1/2 px-2 py-0 whitespace-pre ${bgClass(row.right.type)}`}>
                      {row.right.content}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
