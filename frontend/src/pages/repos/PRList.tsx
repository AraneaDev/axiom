import { useQuery } from '@tanstack/react-query';
import { GitPullRequest, Plus, GitMerge, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';

import { orgsApi } from '@/api/orgs.api';
import { reposApi } from '@/api/repos.api';
import { teamsApi } from '@/api/teams.api';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageLoader } from '@/components/ui/Spinner';
import { formatRelative } from '@/lib/utils';

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
  const { org, team: teamSlug, repo: repoSlug } = useParams();
  const [statusFilter, setStatusFilter] = useState<string>('OPEN');

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

  const { data: prs, isLoading } = useQuery({
    queryKey: ['prs', currentRepo?.id, statusFilter],
    queryFn: () => reposApi.listPRs(currentRepo!.id, statusFilter || undefined),
    enabled: !!currentRepo?.id,
  });

  if (isLoading) return <PageLoader />;
  const basePath = `/${org}/${teamSlug}/repos/${repoSlug}`;

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
        {['OPEN', 'MERGED', 'CLOSED', ''].map((s) => (
          <Button
            key={s}
            variant={statusFilter === s ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setStatusFilter(s)}
          >
            {s || 'All'}
          </Button>
        ))}
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
                    #{pr.number} &middot; {pr.sourceBranch} → {pr.targetBranch} &middot;{' '}
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
