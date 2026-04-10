import { useQuery } from '@tanstack/react-query';
import { GitBranch, Plus, Lock, Globe, Building2, AlertTriangle } from 'lucide-react';
import { Link } from 'react-router';

import { reposApi } from '@/api/repos.api';
import { MarkdownRenderer } from '@/components/editor/MarkdownRenderer';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { ListSkeleton } from '@/components/ui/Skeleton';
import { useTeamContext } from '@/hooks/useTeamContext';
import { STABLE_STALE_TIME } from '@/lib/constants';

const VIS_ICON = { PRIVATE: Lock, INTERNAL: Building2, PUBLIC: Globe };
const VIS_BADGE: Record<string, 'default' | 'warning' | 'success'> = {
  PRIVATE: 'default',
  INTERNAL: 'warning',
  PUBLIC: 'success',
};

/**
 *
 */
export default function RepoList() {
  const { org, teamSlug, currentTeam } = useTeamContext();

  const {
    data: repos,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['repos', currentTeam?.id],
    queryFn: () => reposApi.listByTeam(currentTeam!.id),
    enabled: !!currentTeam?.id,
    staleTime: STABLE_STALE_TIME,
  });

  if (isLoading)
    return (
      <div className="px-6 py-4">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">Repositories</h1>
        </div>
        <ListSkeleton rows={6} />
      </div>
    );

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <AlertTriangle className="h-8 w-8 text-danger mx-auto mb-2" />
          <p className="text-secondary">Failed to load repositories</p>
        </div>
      </div>
    );
  }

  return (
    <div className="px-6 py-4">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Repositories</h1>
        <Link to={`/${org}/${teamSlug}/repos/new`}>
          <Button size="sm">
            <Plus className="h-4 w-4" /> New Repository
          </Button>
        </Link>
      </div>
      {!repos?.length ? (
        <EmptyState
          icon={<GitBranch className="h-12 w-12" />}
          title="No repositories"
          description="Create your first repository."
        />
      ) : (
        <Card className="divide-y divide-border">
          {repos.map((repo) => {
            const Icon = VIS_ICON[repo.visibility];
            return (
              <Link
                key={repo.id}
                to={`/${org}/${teamSlug}/repos/${repo.slug}`}
                className="flex items-center gap-3 p-4 hover:bg-surface-secondary transition-colors"
              >
                <GitBranch className="h-5 w-5 text-primary shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{repo.name}</span>
                    <Badge variant={VIS_BADGE[repo.visibility]} className="text-xs">
                      <Icon className="h-3 w-3 mr-1" />
                      {repo.visibility.toLowerCase()}
                    </Badge>
                  </div>
                  {repo.description && (
                    <div className="text-xs text-text-secondary truncate">
                      <MarkdownRenderer content={repo.description} />
                    </div>
                  )}
                </div>
                <span className="text-xs text-text-secondary">{repo.defaultBranch}</span>
              </Link>
            );
          })}
        </Card>
      )}
    </div>
  );
}
