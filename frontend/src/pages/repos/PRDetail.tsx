import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, Link } from 'react-router';
import { GitMerge, GitPullRequest, XCircle, MessageSquare, Check, X } from 'lucide-react';
import { reposApi } from '@/api/repos.api';
import { orgsApi } from '@/api/orgs.api';
import { teamsApi } from '@/api/teams.api';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Avatar } from '@/components/ui/Avatar';
import { Spinner, PageLoader } from '@/components/ui/Spinner';
import { formatRelative } from '@/lib/utils';
import { MarkdownRenderer } from '@/components/editor/MarkdownRenderer';
import { MarkdownEditor } from '@/components/editor/MarkdownEditor';
import type { CommitInfo } from '@/api/repos.api';

const STATUS_BADGE: Record<string, 'primary' | 'success' | 'default'> = { OPEN: 'primary', MERGED: 'success', CLOSED: 'default' };

export default function PRDetail() {
  const { org, team: teamSlug, repo: repoSlug, number: prNum } = useParams();
  const queryClient = useQueryClient();
  const [commentBody, setCommentBody] = useState('');
  const [mergeStrategy, setMergeStrategy] = useState('merge');

  const { data: orgs } = useQuery({ queryKey: ['orgs'], queryFn: orgsApi.list });
  const currentOrg = orgs?.find((o) => o.slug === org);
  const { data: teams } = useQuery({
    queryKey: ['teams', currentOrg?.id], queryFn: () => teamsApi.listByOrg(currentOrg!.id), enabled: !!currentOrg?.id,
  });
  const currentTeam = teams?.find((t) => t.slug === teamSlug);
  const { data: repos } = useQuery({
    queryKey: ['repos', currentTeam?.id], queryFn: () => reposApi.listByTeam(currentTeam!.id), enabled: !!currentTeam?.id,
  });
  const currentRepo = repos?.find((r) => r.slug === repoSlug);
  const prNumber = parseInt(prNum!);

  const { data: pr, isLoading } = useQuery({
    queryKey: ['pr', currentRepo?.id, prNumber],
    queryFn: () => reposApi.getPR(currentRepo!.id, prNumber),
    enabled: !!currentRepo?.id,
  });

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

  const mergeMutation = useMutation({
    mutationFn: () => reposApi.mergePR(currentRepo!.id, prNumber, mergeStrategy),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['pr', currentRepo?.id, prNumber] }),
  });

  const closeMutation = useMutation({
    mutationFn: () => reposApi.closePR(currentRepo!.id, prNumber),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['pr', currentRepo?.id, prNumber] }),
  });

  const reviewMutation = useMutation({
    mutationFn: (data: { status: string; body?: string }) => reposApi.submitReview(currentRepo!.id, prNumber, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['pr', currentRepo?.id, prNumber] }),
  });

  const commentMutation = useMutation({
    mutationFn: () => reposApi.addPRComment(currentRepo!.id, prNumber, { body: commentBody }),
    onSuccess: () => {
      setCommentBody('');
      queryClient.invalidateQueries({ queryKey: ['pr', currentRepo?.id, prNumber] });
    },
  });

  if (isLoading || !pr) return <PageLoader />;
  const basePath = `/${org}/${teamSlug}/repos/${repoSlug}`;

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <h1 className="text-xl font-bold">{pr.title}</h1>
          <Badge variant={STATUS_BADGE[pr.status]}>{pr.status}</Badge>
        </div>
        <p className="text-sm text-text-secondary">
          #{pr.number} &middot; <code className="bg-surface-secondary px-1.5 py-0.5 rounded text-xs">{pr.sourceBranch}</code>
          {' → '}
          <code className="bg-surface-secondary px-1.5 py-0.5 rounded text-xs">{pr.targetBranch}</code>
          {' &middot; '}{formatRelative(pr.createdAt)}
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
                {diff.stats.map((s: any) => (
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
              <h2 className="text-sm font-semibold mb-2">Diff</h2>
              <pre className="rounded-lg border border-border bg-surface p-4 text-xs font-mono overflow-x-auto max-h-[600px] overflow-y-auto">
                {diff.diff.split('\n').map((line: string, i: number) => (
                  <div key={i} className={
                    line.startsWith('+') && !line.startsWith('+++') ? 'text-success bg-success-light' :
                    line.startsWith('-') && !line.startsWith('---') ? 'text-danger bg-danger-light' :
                    line.startsWith('@@') ? 'text-primary bg-primary-light' : ''
                  }>{line}</div>
                ))}
              </pre>
            </div>
          )}

          {/* Reviews */}
          {pr.reviews && pr.reviews.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold mb-2">Reviews</h2>
              <div className="space-y-2">
                {pr.reviews.map((r: any) => (
                  <div key={r.id} className="rounded-lg border border-border bg-surface p-3 flex items-start gap-3">
                    <Badge variant={r.status === 'APPROVED' ? 'success' : r.status === 'CHANGES_REQUESTED' ? 'danger' : 'default'}>
                      {r.status === 'APPROVED' ? 'Approved' : r.status === 'CHANGES_REQUESTED' ? 'Changes requested' : 'Commented'}
                    </Badge>
                    {r.body && <p className="text-sm flex-1">{r.body}</p>}
                    <span className="text-xs text-text-secondary">{formatRelative(r.createdAt)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Comments */}
          {pr.comments && pr.comments.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold mb-2">Comments ({pr.comments.length})</h2>
              <div className="space-y-2">
                {pr.comments.map((c: any) => (
                  <div key={c.id} className="rounded-lg border border-border bg-surface p-3">
                    {c.filePath && (
                      <p className="text-xs font-mono text-text-secondary mb-1">{c.filePath}:{c.line}</p>
                    )}
                    <MarkdownRenderer content={c.body} className="text-sm" />
                    <p className="text-xs text-text-secondary mt-1">{formatRelative(c.createdAt)}</p>
                  </div>
                ))}
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
                <Button size="sm" disabled={!commentBody.trim() || commentMutation.isPending}
                  onClick={() => commentMutation.mutate()}>
                  {commentMutation.isPending ? <Spinner className="h-4 w-4" /> : 'Comment'}
                </Button>
                <Button size="sm" variant="secondary"
                  onClick={() => reviewMutation.mutate({ status: 'APPROVED', body: 'LGTM' })}>
                  <Check className="h-4 w-4" /> Approve
                </Button>
                <Button size="sm" variant="ghost"
                  onClick={() => reviewMutation.mutate({ status: 'CHANGES_REQUESTED', body: 'Please address feedback' })}>
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
              <p className="text-xs text-text-secondary uppercase font-semibold mb-1">Merge status</p>
              {pr.status === 'OPEN' ? (
                pr.mergeable === true ? (
                  <Badge variant="success">No conflicts</Badge>
                ) : pr.mergeable === false ? (
                  <Badge variant="danger">Has conflicts</Badge>
                ) : (
                  <Badge>Unknown</Badge>
                )
              ) : (
                <Badge variant={pr.status === 'MERGED' ? 'success' : 'default'}>{pr.status}</Badge>
              )}
            </div>

            {pr.status === 'OPEN' && (
              <>
                <div>
                  <p className="text-xs text-text-secondary uppercase font-semibold mb-1">Strategy</p>
                  <select value={mergeStrategy} onChange={(e) => setMergeStrategy(e.target.value)}
                    className="w-full text-sm border border-border rounded px-2 py-1">
                    <option value="merge">Merge commit</option>
                    <option value="squash">Squash and merge</option>
                    <option value="rebase">Rebase</option>
                  </select>
                </div>
                <Button className="w-full" disabled={!pr.mergeable || mergeMutation.isPending}
                  onClick={() => mergeMutation.mutate()}>
                  {mergeMutation.isPending ? <Spinner className="h-4 w-4" /> : <><GitMerge className="h-4 w-4" /> Merge</>}
                </Button>
                {mergeMutation.isError && (
                  <p className="text-xs text-danger">{(mergeMutation.error as any)?.message || 'Merge failed'}</p>
                )}
                <Button variant="ghost" className="w-full" onClick={() => closeMutation.mutate()}>
                  <XCircle className="h-4 w-4" /> Close PR
                </Button>
              </>
            )}
          </div>

          <div className="rounded-lg border border-border bg-surface p-4">
            <p className="text-xs text-text-secondary uppercase font-semibold mb-1">Branches</p>
            <p className="text-sm"><code className="bg-surface-secondary px-1 rounded">{pr.sourceBranch}</code></p>
            <p className="text-xs text-text-secondary my-1">into</p>
            <p className="text-sm"><code className="bg-surface-secondary px-1 rounded">{pr.targetBranch}</code></p>
          </div>
        </div>
      </div>
    </div>
  );
}
