import { useQuery } from '@tanstack/react-query';
import { Users, Plus, FolderKanban, AlertTriangle, BarChart3 } from 'lucide-react';
import { Link, useParams } from 'react-router';

import { orgsApi } from '@/api/orgs.api';
import { teamsApi } from '@/api/teams.api';
import { MarkdownRenderer } from '@/components/editor/MarkdownRenderer';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageLoader } from '@/components/ui/Spinner';

/**
 *
 */
export default function TeamList() {
  const { org } = useParams();

  const { data: orgs } = useQuery({ queryKey: ['orgs'], queryFn: orgsApi.list });
  const currentOrg = orgs?.find((o) => o.slug === org);

  const {
    data: teams,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['teams', currentOrg?.id],
    queryFn: () => teamsApi.listByOrg(currentOrg!.id),
    enabled: !!currentOrg?.id,
  });

  if (isLoading) return <PageLoader />;

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <AlertTriangle className="h-8 w-8 text-danger mx-auto mb-2" />
          <p className="text-secondary">Failed to load teams</p>
        </div>
      </div>
    );
  }

  return (
    <div className="">
      <div className="flex items-center justify-between mb-6">
        <h1 className="h2">Teams</h1>
        <div className="flex gap-2">
          <ButtonLink to={`/${org}/analytics`} variant="outline" size="sm">
            <BarChart3 className="mr-1.5 h-4 w-4" />
            Analytics
          </ButtonLink>
          <ButtonLink to={`/${org}/teams/new`} size="sm">
            <Plus className="h-4 w-4" /> New Team
          </ButtonLink>
        </div>
      </div>

      {!teams?.length ? (
        <EmptyState
          icon={<Users className="h-12 w-12" />}
          title="No teams yet"
          description="Create your first team to start organizing work."
          action={
            <ButtonLink to={`/${org}/teams/new`}>
              <Plus className="h-4 w-4" /> Create Team
            </ButtonLink>
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {teams.map((team) => (
            <Link key={team.id} to={`/${org}/${team.slug}`}>
              <Card className="p-5 hover:border-primary/50 hover:shadow-sm transition-all">
                <div className="flex items-center gap-3 mb-3">
                  <div className="flex items-center justify-center h-10 w-10 rounded-md bg-primary-light text-primary">
                    <Users className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="font-semibold">{team.name}</h3>
                    <p className="text-xs text-text-secondary">/{team.slug}</p>
                  </div>
                </div>
                {team.description && (
                  <div className="text-sm text-text-secondary line-clamp-2 mb-3">
                    <MarkdownRenderer content={team.description} />
                  </div>
                )}
                <div className="flex gap-4 text-xs text-text-secondary">
                  <span className="flex items-center gap-1">
                    <Users className="h-3 w-3" /> {team._count?.members ?? 0} members
                  </span>
                  <span className="flex items-center gap-1">
                    <FolderKanban className="h-3 w-3" /> {team._count?.projects ?? 0} projects
                  </span>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
