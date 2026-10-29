import { useQuery } from '@tanstack/react-query';
import {
  FolderKanban,
  BookOpen,
  Users,
  Plus,
  Shield,
  ArrowRight,
  FileText,
  AlertTriangle,
  BarChart3,
} from 'lucide-react';
import { Link } from 'react-router';

import { projectsApi } from '@/api/projects.api';
import { teamsApi } from '@/api/teams.api';
import { wikiApi } from '@/api/wiki.api';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageLoader } from '@/components/ui/Spinner';
import { Tooltip } from '@/components/ui/Tooltip';
import { useTeamContext } from '@/hooks/useTeamContext';

import { TeamActivityCard } from './TeamActivityCard';
import { TeamProjectsSection } from './TeamProjectsSection';

/**
 *
 */
export default function TeamDetail() {
  const { org, teamSlug, currentTeam } = useTeamContext();

  const {
    data: projects,
    isLoading: projectsLoading,
    error,
  } = useQuery({
    queryKey: ['projects', currentTeam?.id],
    queryFn: () => projectsApi.listByTeam(currentTeam!.id),
    enabled: !!currentTeam?.id,
  });

  const { data: spaces } = useQuery({
    queryKey: ['wikiSpaces', currentTeam?.id],
    queryFn: () => wikiApi.listSpaces(currentTeam!.id),
    enabled: !!currentTeam?.id,
  });

  const { data: teamDetail } = useQuery({
    queryKey: ['team', currentTeam?.id],
    queryFn: () => teamsApi.get(currentTeam!.id),
    enabled: !!currentTeam?.id,
  });

  const { data: activity } = useQuery({
    queryKey: ['team-activity', currentTeam?.id],
    queryFn: () => teamsApi.getActivity(currentTeam!.id),
    enabled: !!currentTeam?.id,
  });

  if (projectsLoading) return <PageLoader />;

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <AlertTriangle className="h-8 w-8 text-danger mx-auto mb-2" />
          <p className="text-secondary">Failed to load team details</p>
        </div>
      </div>
    );
  }

  return (
    <div className="">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="h2">{currentTeam?.name}</h1>
          {currentTeam?.description && (
            <p className="text-text-secondary text-sm mt-1">{currentTeam.description}</p>
          )}
        </div>
        <div className="flex gap-2">
          <Link to={`/${org}/${teamSlug}/analytics`}>
            <Button variant="outline" size="sm">
              <BarChart3 className="mr-1.5 h-4 w-4" />
              Analytics
            </Button>
          </Link>
          <Link to={`/${org}/${teamSlug}/members`}>
            <Button variant="secondary" size="sm">
              <Users className="h-4 w-4" /> Members
            </Button>
          </Link>
        </div>
      </div>

      {/* Main layout: content + sidebar */}
      <div className="flex flex-col lg:grid lg:grid-cols-[1fr_340px] gap-8">
        {/* Main content */}
        <div className="flex flex-col gap-6">
          {/* Projects */}
          <TeamProjectsSection projects={projects} orgSlug={org} teamSlug={teamSlug} />

          {/* Wiki Spaces */}
          {(spaces?.length ?? 0) > 0 ? (
            <section>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <BookOpen className="h-5 w-5 text-primary" />
                  <h2 className="h3">Wiki</h2>
                </div>
                <Link to={`/${org}/${teamSlug}/wiki/new`}>
                  <Button variant="ghost" size="sm">
                    <Plus className="h-4 w-4" /> New Space
                  </Button>
                </Link>
              </div>
              <div className="space-y-2">
                {spaces!.map((s) => (
                  <Link
                    key={s.id}
                    to={`/${org}/${teamSlug}/wiki/${s.slug}`}
                    className="group bg-surface flex items-center gap-3 rounded-lg border border-border px-4 py-3 hover:border-primary/50 hover:shadow-sm transition-all"
                  >
                    <BookOpen className="h-4 w-4 text-text-secondary shrink-0" />
                    <div className="flex-1 min-w-0">
                      <span className="font-medium text-text">{s.name}</span>
                      {s.description && (
                        <p className="text-xs text-text-tertiary line-clamp-1 mt-0.5">
                          {s.description}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 text-xs text-text-tertiary">
                      <FileText className="h-3 w-3" />
                      {s._count?.pages ?? 0} pages
                    </div>
                    <ArrowRight className="h-3.5 w-3.5 text-text-tertiary opacity-0 group-hover:opacity-100 transition-opacity" />
                  </Link>
                ))}
              </div>
            </section>
          ) : (
            <section>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <BookOpen className="h-5 w-5 text-primary" />
                  <h2 className="h3">Wiki</h2>
                </div>
              </div>
              <EmptyState
                icon={<BookOpen className="h-10 w-10" />}
                title="No wiki spaces yet"
                description="Create a wiki space for team documentation."
                action={
                  <Link to={`/${org}/${teamSlug}/wiki/new`}>
                    <Button variant="secondary" size="sm">
                      <Plus className="h-4 w-4" /> Create Wiki Space
                    </Button>
                  </Link>
                }
              />
            </section>
          )}
        </div>

        {/* Sidebar: Members + Activity (sticky, like issue detail) */}
        <div className="lg:sticky lg:top-4 lg:self-start lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto flex flex-col gap-6">
          {/* Quick Stats */}
          <div className="grid grid-cols-2 gap-3">
            <Card className="p-3 text-center">
              <div className="flex items-center justify-center gap-1.5 mb-1">
                <FolderKanban className="h-3.5 w-3.5 text-primary" />
                <span className="text-lg font-bold text-text">{projects?.length ?? 0}</span>
              </div>
              <p className="text-[10px] text-text-tertiary uppercase tracking-wide">Projects</p>
            </Card>
            <Card className="p-3 text-center">
              <div className="flex items-center justify-center gap-1.5 mb-1">
                <BookOpen className="h-3.5 w-3.5 text-primary" />
                <span className="text-lg font-bold text-text">{spaces?.length ?? 0}</span>
              </div>
              <p className="text-[10px] text-text-tertiary uppercase tracking-wide">Wiki</p>
            </Card>
          </div>

          {/* Team Members */}
          {teamDetail?.members && (
            <Card className="p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-text-tertiary">
                  Members ({teamDetail.members.length})
                </h3>
                <Tooltip content="View all members">
                  <Link to={`/${org}/${teamSlug}/members`}>
                    <Button variant="ghost" size="xs" title="View all members">
                      <Users className="h-3.5 w-3.5" />
                    </Button>
                  </Link>
                </Tooltip>
              </div>
              <div className="space-y-1">
                {teamDetail.members.slice(0, 10).map(
                  (m: {
                    id: string;
                    role: string;
                    user: {
                      displayName: string;
                      username: string;
                      avatarUrl?: string | null;
                    };
                  }) => (
                    <Link
                      key={m.id}
                      to={`/${org}/${teamSlug}/members/${m.user.username}`}
                      className="flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-surface-secondary transition-colors"
                    >
                      <Avatar
                        name={m.user.displayName}
                        src={m.user.avatarUrl ?? undefined}
                        size="sm"
                      />
                      <span className="text-sm font-medium text-text flex-1 truncate">
                        {m.user.displayName}
                      </span>
                      <Badge variant="outline" size="sm">
                        <Shield className="h-3 w-3" />
                        {m.role.toLowerCase()}
                      </Badge>
                    </Link>
                  ),
                )}
                {teamDetail.members.length > 10 && (
                  <Link
                    to={`/${org}/${teamSlug}/members`}
                    className="block text-xs text-primary hover:underline text-center pt-2"
                  >
                    View all {teamDetail.members.length} members
                  </Link>
                )}
              </div>
            </Card>
          )}

          {/* Recent Activity */}
          <TeamActivityCard activity={activity} orgSlug={org} teamSlug={teamSlug} />
        </div>
      </div>
    </div>
  );
}
