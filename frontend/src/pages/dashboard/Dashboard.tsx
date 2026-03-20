import { useQuery } from '@tanstack/react-query';
import type { LucideIcon } from 'lucide-react';
import {
  Plus,
  Building2,
  ArrowRight,
  Users,
  GitBranch,
  FolderKanban,
  ListChecks,
  GitPullRequest,
  Activity,
  CalendarClock,
  Clock,
  AlertTriangle,
  ExternalLink,
} from 'lucide-react';
import { Link } from 'react-router';

import { dashboardApi } from '@/api/dashboard.api';
import type { DashboardIssue, DashboardPR, DashboardActivity } from '@/api/dashboard.api';
import { orgsApi } from '@/api/orgs.api';
import { teamsApi } from '@/api/teams.api';
import { MarkdownRenderer } from '@/components/editor/MarkdownRenderer';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton, CardSkeleton } from '@/components/ui/Skeleton';
import { PRIORITY_COLORS, STABLE_STALE_TIME } from '@/lib/constants';
import type { Team } from '@/lib/types';
import { cn, formatRelative } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth.store';

// ─── Widget wrapper ─────────────────────────────────────────

function Widget({
  icon: Icon,
  title,
  count,
  viewAllLink,
  children,
  className,
}: {
  icon: LucideIcon;
  title: string;
  count?: number;
  viewAllLink?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('rounded-xl border border-border bg-surface flex flex-col', className)}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-primary" />
          <h3 className="font-semibold text-sm text-text">{title}</h3>
          {count !== undefined && count > 0 && (
            <Badge variant="default" size="sm">
              {count}
            </Badge>
          )}
        </div>
        {viewAllLink && (
          <Link
            to={viewAllLink}
            className="text-xs text-primary hover:text-primary-hover flex items-center gap-1"
          >
            View all <ExternalLink className="h-3 w-3" />
          </Link>
        )}
      </div>
      <div className="overflow-y-auto max-h-80">{children}</div>
    </div>
  );
}

// ─── My Issues widget ───────────────────────────────────────

function MyIssuesWidget({ issues }: { issues: DashboardIssue[] }) {
  // Group by project
  const grouped = issues.reduce<
    Record<string, { project: DashboardIssue['project']; issues: DashboardIssue[] }>
  >((acc, issue) => {
    const key = issue.project.id;
    if (!acc[key]) acc[key] = { project: issue.project, issues: [] };
    acc[key].issues.push(issue);
    return acc;
  }, {});

  return (
    <Widget icon={ListChecks} title="My Issues" count={issues.length}>
      {issues.length === 0 ? (
        <div className="p-6 text-center text-sm text-text-tertiary">
          No open issues assigned to you
        </div>
      ) : (
        <div className="divide-y divide-border">
          {Object.values(grouped).map(({ project, issues: projectIssues }) => (
            <div key={project.id}>
              <div className="px-4 py-2 bg-surface-secondary/50">
                <Link
                  to={`/${project.team.org.slug}/${project.team.slug}/${project.slug}/issues`}
                  className="text-xs font-medium text-text-secondary hover:text-primary"
                >
                  {project.team.org.slug} / {project.team.slug} / {project.name}
                </Link>
              </div>
              {projectIssues.map((issue) => (
                <Link
                  key={issue.id}
                  to={`/${issue.project.team.org.slug}/${issue.project.team.slug}/${issue.project.slug}/issues/${issue.number}`}
                  className="flex items-center gap-3 px-4 py-2 hover:bg-surface-secondary transition-colors"
                >
                  <span className="text-xs font-mono text-text-secondary w-14 shrink-0">
                    {issue.key}
                  </span>
                  <span className="text-sm truncate flex-1">{issue.title}</span>
                  <span
                    className={cn(
                      'text-xs px-2 py-0.5 rounded-full shrink-0',
                      PRIORITY_COLORS[issue.priority as keyof typeof PRIORITY_COLORS],
                    )}
                  >
                    {issue.priority}
                  </span>
                  {issue.column && (
                    <span className="text-xs text-text-tertiary shrink-0">{issue.column.name}</span>
                  )}
                </Link>
              ))}
            </div>
          ))}
        </div>
      )}
    </Widget>
  );
}

// ─── Review Requests widget ─────────────────────────────────

function ReviewRequestsWidget({ prs }: { prs: DashboardPR[] }) {
  return (
    <Widget icon={GitPullRequest} title="Review Requests" count={prs.length}>
      {prs.length === 0 ? (
        <div className="p-6 text-center text-sm text-text-tertiary">No pending review requests</div>
      ) : (
        <div className="divide-y divide-border">
          {prs.map((pr) => {
            const prLink = pr.repo.team
              ? `/${pr.repo.team.org.slug}/${pr.repo.team.slug}/repos/${pr.repo.slug}/pulls/${pr.number}`
              : null;
            const content = (
              <>
                <GitPullRequest className="h-4 w-4 text-success shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{pr.title}</p>
                  <p className="text-xs text-text-tertiary">
                    {pr.repo.name} #{pr.number} by {pr.author.displayName}
                  </p>
                </div>
                <span className="text-xs text-text-tertiary shrink-0 flex items-center gap-1">
                  <Clock className="h-3 w-3" /> {formatRelative(pr.createdAt)}
                </span>
              </>
            );
            return prLink ? (
              <Link
                key={pr.id}
                to={prLink}
                className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-secondary transition-colors"
              >
                {content}
              </Link>
            ) : (
              <div
                key={pr.id}
                className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-secondary transition-colors"
              >
                {content}
              </div>
            );
          })}
        </div>
      )}
    </Widget>
  );
}

// ─── Recent Activity widget ─────────────────────────────────

function RecentActivityWidget({ activities }: { activities: DashboardActivity[] }) {
  return (
    <Widget icon={Activity} title="Recent Activity" count={activities.length}>
      {activities.length === 0 ? (
        <div className="p-6 text-center text-sm text-text-tertiary">No recent activity</div>
      ) : (
        <div className="divide-y divide-border">
          {activities.map((a) => (
            <div key={a.id} className="flex items-start gap-3 px-4 py-2.5">
              <Avatar
                name={a.user.displayName}
                src={a.user.avatarUrl ?? undefined}
                size="sm"
                className="mt-0.5"
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm">
                  <span className="font-medium">{a.user.displayName}</span>{' '}
                  <span className="text-text-secondary">{a.action}</span>{' '}
                  <span className="text-text-secondary">{a.resourceType?.toLowerCase()}</span>
                </p>
              </div>
              <span className="text-xs text-text-tertiary shrink-0">
                {formatRelative(a.createdAt)}
              </span>
            </div>
          ))}
        </div>
      )}
    </Widget>
  );
}

// ─── Upcoming Due Dates widget ──────────────────────────────

function UpcomingDueDatesWidget({ issues }: { issues: DashboardIssue[] }) {
  const getDaysRemaining = (dueDate: string) => {
    const now = new Date();
    const due = new Date(dueDate);
    return Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  };

  const getDueBadgeClass = (days: number) => {
    if (days < 0) return 'bg-danger-light text-danger';
    if (days < 3) return 'bg-warning/10 text-warning';
    return 'bg-surface-secondary text-text-secondary';
  };

  const getDueLabel = (days: number) => {
    if (days < 0) return `${Math.abs(days)}d overdue`;
    if (days === 0) return 'Due today';
    if (days === 1) return 'Due tomorrow';
    return `${days}d left`;
  };

  return (
    <Widget icon={CalendarClock} title="Upcoming Due Dates" count={issues.length}>
      {issues.length === 0 ? (
        <div className="p-6 text-center text-sm text-text-tertiary">No upcoming deadlines</div>
      ) : (
        <div className="divide-y divide-border">
          {issues.map((issue) => {
            const days = getDaysRemaining(issue.dueDate!);
            return (
              <Link
                key={issue.id}
                to={`/${issue.project.team.org.slug}/${issue.project.team.slug}/${issue.project.slug}/issues/${issue.number}`}
                className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-secondary transition-colors"
              >
                {days < 3 && <AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0" />}
                <span className="text-xs font-mono text-text-secondary w-14 shrink-0">
                  {issue.key}
                </span>
                <span className="text-sm truncate flex-1">{issue.title}</span>
                <span
                  className={cn(
                    'text-xs px-2 py-0.5 rounded-full shrink-0',
                    getDueBadgeClass(days),
                  )}
                >
                  {getDueLabel(days)}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </Widget>
  );
}

// ─── Team Card ──────────────────────────────────────────────

function TeamCard({
  team,
  orgSlug,
}: {
  team: Team & { _count?: { members: number; repos: number; projects: number } };
  orgSlug: string;
}) {
  return (
    <Link
      to={`/${orgSlug}/${team.slug}`}
      className="group rounded-xl border border-border bg-surface p-5 hover:border-primary/40 hover:shadow-md transition-all duration-200"
    >
      <div className="flex items-center gap-3 mb-3">
        <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center">
          <Users className="h-4 w-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-text text-sm truncate">{team.name}</h3>
          <p className="text-xs text-text-tertiary">/{team.slug}</p>
        </div>
        <ArrowRight className="h-4 w-4 text-text-tertiary opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
      </div>
      {team.description && (
        <div className="text-sm text-text-secondary line-clamp-2 mb-3">
          <MarkdownRenderer content={team.description} />
        </div>
      )}
      <div className="flex gap-4 text-xs text-text-tertiary">
        <span className="flex items-center gap-1">
          <FolderKanban className="h-3 w-3" /> {team._count?.projects ?? 0} projects
        </span>
        <span className="flex items-center gap-1">
          <GitBranch className="h-3 w-3" /> {team._count?.repos ?? 0} repos
        </span>
        <span className="flex items-center gap-1">
          <Users className="h-3 w-3" /> {team._count?.members ?? 0} members
        </span>
      </div>
    </Link>
  );
}

// ─── Main Dashboard ─────────────────────────────────────────

/**
 *
 */
export default function Dashboard() {
  const { user } = useAuthStore();
  const { data: orgs, isLoading: orgsLoading } = useQuery({
    queryKey: ['orgs'],
    queryFn: orgsApi.list,
    staleTime: STABLE_STALE_TIME,
  });
  const { data: dashboardData, isLoading: dashLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: dashboardApi.get,
  });

  // Fetch teams for first org
  const firstOrg = orgs?.[0];
  const { data: teams } = useQuery({
    queryKey: ['teams', firstOrg?.id],
    queryFn: () => teamsApi.listByOrg(firstOrg!.id),
    enabled: !!firstOrg?.id,
    staleTime: STABLE_STALE_TIME,
  });

  if (orgsLoading || dashLoading)
    return (
      <div className="max-w-7xl mx-auto space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <Skeleton className="h-8 w-64 mb-2" />
            <Skeleton className="h-4 w-40" />
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
        <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      </div>
    );

  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const dateStr = now.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text">
            {greeting}, {user?.displayName?.split(' ')[0]}
          </h1>
          <p className="text-text-tertiary text-sm mt-1">{dateStr}</p>
        </div>
        <Link to="/orgs/new">
          <Button variant="outline" size="sm">
            <Plus className="h-3.5 w-3.5" /> New Organization
          </Button>
        </Link>
      </div>

      {!orgs?.length ? (
        <EmptyState
          icon={<Building2 className="h-12 w-12" />}
          title="No organizations yet"
          description="Create your first organization to start managing projects and documentation."
          action={
            <Link to="/orgs/new">
              <Button>
                <Plus className="h-4 w-4" /> Create Organization
              </Button>
            </Link>
          }
        />
      ) : (
        <>
          {/* Quick stats */}
          {dashboardData && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                {
                  icon: ListChecks,
                  label: 'Open Issues',
                  value: dashboardData.assignedIssues?.length ?? 0,
                },
                {
                  icon: GitPullRequest,
                  label: 'Review Requests',
                  value: dashboardData.reviewRequests?.length ?? 0,
                },
                {
                  icon: CalendarClock,
                  label: 'Due Soon',
                  value: dashboardData.upcomingDueDates?.length ?? 0,
                },
                {
                  icon: Activity,
                  label: 'Recent Events',
                  value: dashboardData.recentActivity?.length ?? 0,
                },
              ].map(({ icon: StatIcon, label, value }) => (
                <div
                  key={label}
                  className="rounded-xl border border-border bg-surface p-4 flex items-center gap-3 hover:border-primary/30 transition-colors"
                >
                  <div className="h-9 w-9 rounded-lg bg-primary-light flex items-center justify-center shrink-0">
                    <StatIcon className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <p className="text-xl font-bold text-text leading-none">{value}</p>
                    <p className="text-xs text-text-tertiary mt-1">{label}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Widget grid */}
          <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
            <MyIssuesWidget issues={dashboardData?.assignedIssues ?? []} />
            <ReviewRequestsWidget prs={dashboardData?.reviewRequests ?? []} />
            <UpcomingDueDatesWidget issues={dashboardData?.upcomingDueDates ?? []} />
            <RecentActivityWidget activities={dashboardData?.recentActivity ?? []} />
          </div>

          {/* Org cards */}
          <div>
            <h2 className="text-lg font-semibold text-text mb-3">Organizations</h2>
            <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
              {orgs.map((org) => (
                <Link
                  key={org.id}
                  to={`/${org.slug}`}
                  className="group rounded-xl border border-border bg-surface overflow-hidden hover:border-primary/40 hover:shadow-md transition-all duration-200"
                >
                  <div className="h-16 bg-primary-light flex items-end px-5 pb-3">
                    <div className="h-10 w-10 rounded-lg bg-primary flex items-center justify-center shadow-sm -mb-5 ring-2 ring-surface">
                      <span className="text-white text-sm font-bold">{org.name[0]}</span>
                    </div>
                  </div>
                  <div className="p-5 pt-7">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold text-text text-sm truncate">{org.name}</h3>
                      <Badge variant="outline" size="sm">
                        {org.role?.toLowerCase()}
                      </Badge>
                    </div>
                    <p className="text-xs text-text-tertiary mb-2">/{org.slug}</p>
                    {org.description && (
                      <div className="text-sm text-text-secondary line-clamp-2 mb-3">
                        <MarkdownRenderer content={org.description} />
                      </div>
                    )}
                    <div className="flex items-center text-xs text-text-tertiary group-hover:text-primary transition-colors">
                      <span>Open workspace</span>
                      <ArrowRight className="h-3 w-3 ml-1 group-hover:translate-x-0.5 transition-transform" />
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>

          {/* Teams overview */}
          {teams && teams.length > 0 && (
            <div>
              <h2 className="text-lg font-semibold text-text mb-3">Teams</h2>
              <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
                {teams.map((team) => (
                  <TeamCard key={team.id} team={team} orgSlug={firstOrg!.slug} />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
