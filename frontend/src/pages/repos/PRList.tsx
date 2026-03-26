import { useQuery } from '@tanstack/react-query';
import { Eye, GitPullRequest, Plus, GitMerge, XCircle, AlertTriangle } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';

import { reposApi } from '@/api/repos.api';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton, ListSkeleton } from '@/components/ui/Skeleton';
import { useRepoContext } from '@/hooks/useRepoContext';
import { formatRelative } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth.store';

const STATUS_BADGE: Record<string, 'success' | 'primary' | 'default'> = {
  OPEN: 'primary',
  MERGED: 'success',
  CLOSED: 'default',
};
const STATUS_ICON = { OPEN: GitPullRequest, MERGED: GitMerge, CLOSED: XCircle };

/**
 *
 */
export default function PRList() {
  const { org, teamSlug, currentRepo, basePath } = useRepoContext();
  const [statusFilter, setStatusFilter] = useState<string>('OPEN');
  const [myReviews, setMyReviews] = useState(false);
  const { user } = useAuthStore();

  const {
    data: prs,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['prs', currentRepo?.id, statusFilter, myReviews ? user?.id : null],
    queryFn: () =>
      reposApi.listPRs(
        currentRepo!.id,
        statusFilter || undefined,
        myReviews ? user?.id : undefined,
      ),
    enabled: !!currentRepo?.id,
  });

  if (isLoading)
    return (
      <div>
        <div className="flex items-center justify-between mb-4">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-8 w-24 rounded-md" />
        </div>
        <div className="flex gap-2 mb-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-20 rounded-md" />
          ))}
        </div>
        <ListSkeleton rows={5} />
      </div>
    );

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <AlertTriangle className="h-8 w-8 text-danger mx-auto mb-2" />
          <p className="text-secondary">Failed to load pull requests</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Pull Requests</h1>
        <Link to={`${basePath}/pulls/new`}>
          <Button size="sm">
            <Plus className="h-4 w-4" /> New PR
          </Button>
        </Link>
      </div>

      <div className="flex gap-2 mb-4">
        {(['OPEN', 'MERGED', 'CLOSED', ''] as const).map((s) => {
          const Icon = s ? STATUS_ICON[s] : GitPullRequest;
          return (
            <Button
              key={s}
              variant={statusFilter === s ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => setStatusFilter(s)}
            >
              <Icon className="h-4 w-4" /> {s || 'All'}
            </Button>
          );
        })}
        <div className="ml-auto">
          <Button
            variant={myReviews ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setMyReviews(!myReviews)}
          >
            <Eye className="h-4 w-4" /> My Reviews
          </Button>
        </div>
      </div>

      {!prs?.length ? (
        <EmptyState
          icon={<GitPullRequest className="h-10 w-10" />}
          title="No pull requests"
          description={
            statusFilter ? `No ${statusFilter.toLowerCase()} PRs` : 'Create your first PR.'
          }
        />
      ) : (
        <div className="rounded-lg border border-border bg-surface divide-y divide-border">
          {prs.map((pr) => {
            const Icon = STATUS_ICON[pr.status] ?? GitPullRequest;
            return (
              <Link
                key={pr.id}
                to={`${basePath}/pulls/${pr.number}`}
                className="flex items-center gap-3 p-4 hover:bg-surface-secondary transition-colors"
              >
                <Icon className="h-5 w-5 text-primary shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{pr.title}</span>
                    <Badge variant={STATUS_BADGE[pr.status]}>{pr.status}</Badge>
                  </div>
                  <p className="text-xs text-text-secondary">
                    #{pr.number}
                    {pr.author && (
                      <>
                        {' '}
                        &middot;{' '}
                        <Link
                          to={`/${org}/${teamSlug}/members/${pr.author.username}`}
                          className="hover:text-primary hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {pr.author.displayName}
                        </Link>
                      </>
                    )}{' '}
                    &middot; {pr.sourceBranch} → {pr.targetBranch} &middot;{' '}
                    {formatRelative(pr.createdAt)}
                  </p>
                </div>
                <div className="flex gap-3 text-xs text-text-secondary">
                  {pr._count && <span>{pr._count.reviews} reviews</span>}
                  {pr._count && <span>{pr._count.comments} comments</span>}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
