import { useQuery } from '@tanstack/react-query';
import {
  FolderKanban,
  BookOpen,
  Users,
  Plus,
  GitBranch,
  GitPullRequest,
  Clock,
  Shield,
  ArrowRight,
  FileText,
  AlertTriangle,
} from 'lucide-react';
import { Link } from 'react-router';

import { projectsApi } from '@/api/projects.api';
import { reposApi } from '@/api/repos.api';
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
import { cn, formatRelative } from '@/lib/utils';

const ACTION_LABELS: Record<string, string> = {
  created: 'created',
  updated: 'updated',
  status_changed: 'changed status of',
  assigned: 'assigned',
  unassigned: 'unassigned',
  commented: 'commented on',
  merged: 'merged',
  closed: 'closed',
  labeled: 'labeled',
  priority_changed: 'changed priority of',
  type_changed: 'changed type of',
  review_submitted: 'reviewed',
  deleted: 'deleted',
  time_logged: 'logged time on',
};

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

  const { data: repos } = useQuery({
    queryKey: ['repos', currentTeam?.id],
    queryFn: () => reposApi.listByTeam(currentTeam!.id),
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

  const { data: openPRs } = useQuery({
    queryKey: ['team-open-prs', currentTeam?.id],
    queryFn: () => teamsApi.listOpenPRs(currentTeam!.id),
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
    <div className="px-6 py-4">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">{currentTeam?.name}</h1>
          {currentTeam?.description && (
            <p className="text-text-secondary text-sm mt-1">{currentTeam.description}</p>
          )}
        </div>
        <div className="flex gap-2">
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
        <div className="space-y-6">
          {/* Projects - full width, prominent cards */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <FolderKanban className="h-5 w-5 text-primary" />
                <h2 className="text-lg font-semibold">Projects</h2>
              </div>
              <Link to={`/${org}/${teamSlug}/projects/new`}>
                <Button variant="ghost" size="sm">
                  <Plus className="h-4 w-4" /> New Project
                </Button>
              </Link>
            </div>
            {!projects?.length ? (
              <EmptyState
                icon={<FolderKanban className="h-10 w-10" />}
                title="No projects yet"
                description="Create a project to start tracking issues."
              />
            ) : (
              <div className="space-y-2">
                {projects.map((p) => (
                  <Link
                    key={p.id}
                    to={`/${org}/${teamSlug}/${p.slug}/board`}
                    className="group bg-surface flex items-center gap-4 rounded-lg border border-border p-4 hover:border-primary/50 hover:shadow-sm transition-all"
                  >
                    <div className="h-10 w-10 rounded-lg bg-primary-light flex items-center justify-center shrink-0">
                      <FolderKanban className="h-5 w-5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="font-semibold text-text">{p.name}</span>
                        <Badge variant="outline" size="sm">
                          {p.prefix}
                        </Badge>
                      </div>
                      {p.description && (
                        <p className="text-sm text-text-secondary line-clamp-1">{p.description}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-4 shrink-0">
                      <div className="text-center">
                        <p className="text-lg font-bold text-text">{p._count?.issues ?? 0}</p>
                        <p className="text-[10px] text-text-tertiary uppercase tracking-wide">
                          Issues
                        </p>
                      </div>
                      <ArrowRight className="h-4 w-4 text-text-tertiary opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>

          {/* Wiki Spaces */}
          {(spaces?.length ?? 0) > 0 ? (
            <section>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <BookOpen className="h-5 w-5 text-primary" />
                  <h2 className="text-lg font-semibold">Wiki</h2>
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
                  <h2 className="text-lg font-semibold">Wiki</h2>
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

          {/* Open Pull Requests */}
          {(openPRs?.length ?? 0) > 0 && (
            <section>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <GitPullRequest className="h-5 w-5 text-success" />
                  <h2 className="text-lg font-semibold">Open Pull Requests</h2>
                  <Badge variant="default" size="sm">
                    {openPRs!.length}
                  </Badge>
                </div>
              </div>
              <div className="space-y-2">
                {openPRs!.map((pr) => (
                  <Link
                    key={pr.id}
                    to={`/${org}/${teamSlug}/repos/${pr.repo.slug}/pulls/${pr.number}`}
                    className="group bg-surface flex items-center gap-3 rounded-lg border border-border px-4 py-3 hover:border-primary/50 hover:shadow-sm transition-all"
                  >
                    <GitPullRequest className="h-4 w-4 text-success shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm text-text truncate">{pr.title}</span>
                        <Badge variant="outline" size="sm">
                          {pr.repo.name}
                        </Badge>
                      </div>
                      <p className="text-xs text-text-tertiary mt-0.5">
                        #{pr.number} by {pr.author.displayName}
                        <span className="mx-1">&middot;</span>
                        {pr.sourceBranch} <ArrowRight className="h-3 w-3 inline" />{' '}
                        {pr.targetBranch}
                      </p>
                    </div>
                    <span className="text-xs text-text-tertiary shrink-0 flex items-center gap-1">
                      <Clock className="h-3 w-3" /> {formatRelative(pr.createdAt)}
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {/* Repositories - full width list */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <GitBranch className="h-5 w-5 text-primary" />
                <h2 className="text-lg font-semibold">Repositories</h2>
              </div>
              <Link to={`/${org}/${teamSlug}/repos/new`}>
                <Button variant="ghost" size="sm">
                  <Plus className="h-4 w-4" /> New Repo
                </Button>
              </Link>
            </div>
            {!repos?.length ? (
              <EmptyState
                icon={<GitBranch className="h-10 w-10" />}
                title="No repositories yet"
                description="Create a repository to start hosting code."
              />
            ) : (
              <div className="space-y-2">
                {repos.map((r) => (
                  <Link
                    key={r.id}
                    to={`/${org}/${teamSlug}/repos/${r.slug}`}
                    className="group bg-surface flex items-center gap-3 rounded-lg border border-border px-4 py-3 hover:border-primary/50 hover:shadow-sm transition-all"
                  >
                    <GitBranch className="h-4 w-4 text-text-secondary shrink-0" />
                    <div className="flex-1 min-w-0">
                      <span className="font-medium text-text">{r.name}</span>
                      {r.description && (
                        <p className="text-xs text-text-tertiary line-clamp-1 mt-0.5">
                          {r.description}
                        </p>
                      )}
                    </div>
                    <Badge
                      variant="outline"
                      size="sm"
                      className={cn(
                        r.visibility === 'PUBLIC' && 'text-success border-success/30',
                        r.visibility === 'PRIVATE' && 'text-text-tertiary',
                      )}
                    >
                      {r.visibility.toLowerCase()}
                    </Badge>
                    <span className="text-xs text-text-tertiary">{r.defaultBranch}</span>
                    <ArrowRight className="h-3.5 w-3.5 text-text-tertiary opacity-0 group-hover:opacity-100 transition-opacity" />
                  </Link>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Sidebar: Members + Activity (sticky, like issue detail) */}
        <div className="lg:sticky lg:top-4 lg:self-start lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto space-y-6">
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
            <Card className="p-3 text-center">
              <div className="flex items-center justify-center gap-1.5 mb-1">
                <GitPullRequest className="h-3.5 w-3.5 text-success" />
                <span className="text-lg font-bold text-text">{openPRs?.length ?? 0}</span>
              </div>
              <p className="text-[10px] text-text-tertiary uppercase tracking-wide">Open PRs</p>
            </Card>
            <Card className="p-3 text-center">
              <div className="flex items-center justify-center gap-1.5 mb-1">
                <GitBranch className="h-3.5 w-3.5 text-primary" />
                <span className="text-lg font-bold text-text">{repos?.length ?? 0}</span>
              </div>
              <p className="text-[10px] text-text-tertiary uppercase tracking-wide">Repos</p>
            </Card>
          </div>

          {/* Team Members */}
          {teamDetail?.members && (
            <Card className="p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-text-tertiary">
                  Members ({teamDetail.members.length})
                </h3>
                <Tooltip content="View all members">
                  <Link to={`/${org}/${teamSlug}/members`}>
                    <Button variant="ghost" size="xs">
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
          <Card className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-text-tertiary">
                Recent Activity
              </h3>
              {activity && activity.length > 0 && (
                <Badge variant="default" size="sm">
                  {activity.length}
                </Badge>
              )}
            </div>
            {!activity?.length ? (
              <p className="text-sm text-text-tertiary py-3">No recent activity.</p>
            ) : (
              <div className="space-y-0 divide-y divide-border-light">
                {activity.slice(0, 5).map((a) => {
                  const actionLabel = ACTION_LABELS[a.action] ?? a.action;

                  const resourceContent = a.resourceTitle ? (
                    <>
                      {a.resourceKey && (
                        <span className="font-mono text-xs text-text-secondary">
                          {a.resourceKey}
                        </span>
                      )}{' '}
                      <span className="text-text">{a.resourceTitle}</span>
                    </>
                  ) : (
                    <span className="text-text-secondary">
                      {a.resourceType?.replace(/_/g, ' ').toLowerCase()}
                    </span>
                  );

                  return (
                    <div
                      key={a.id}
                      className="flex items-start gap-2.5 py-2.5 first:pt-0 last:pb-0"
                    >
                      <Avatar
                        name={a.user.displayName}
                        src={a.user.avatarUrl ?? undefined}
                        size="sm"
                        className="mt-0.5 shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm leading-snug">
                          <Link
                            to={`/${org}/${teamSlug}/members/${a.user.username}`}
                            className="font-medium text-text hover:text-primary transition-colors"
                          >
                            {a.user.displayName}
                          </Link>{' '}
                          <span className="text-text-secondary">{actionLabel}</span>{' '}
                          {a.resourceLink ? (
                            <Link to={a.resourceLink} className="text-primary hover:underline">
                              {resourceContent}
                            </Link>
                          ) : (
                            resourceContent
                          )}
                        </p>
                        <span className="text-xs text-text-tertiary flex items-center gap-1 mt-0.5">
                          <Clock className="h-3 w-3" /> {formatRelative(a.createdAt)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
