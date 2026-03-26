import { useQuery } from '@tanstack/react-query';
import {
  Plus,
  Building2,
  ArrowRight,
  ListChecks,
  GitPullRequest,
  Activity,
  CalendarClock,
} from 'lucide-react';
import { Link } from 'react-router';

import { TeamCard } from './DashboardTeamStats';
import {
  MyIssuesWidget,
  ReviewRequestsWidget,
  UpcomingDueDatesWidget,
  RecentActivityWidget,
  SprintHealthWidget,
} from './DashboardWidgets';

import { dashboardApi } from '@/api/dashboard.api';
import { orgsApi } from '@/api/orgs.api';
import { teamsApi } from '@/api/teams.api';
import { MarkdownRenderer } from '@/components/editor/MarkdownRenderer';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton, CardSkeleton } from '@/components/ui/Skeleton';
import { STABLE_STALE_TIME } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth.store';

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
      <div className="space-y-6">
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
    <div className="space-y-8">
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
                  bg: 'bg-primary-light',
                  fg: 'text-primary',
                },
                {
                  icon: GitPullRequest,
                  label: 'Review Requests',
                  value: dashboardData.reviewRequests?.length ?? 0,
                  bg: 'bg-accent-light',
                  fg: 'text-accent',
                },
                {
                  icon: CalendarClock,
                  label: 'Due Soon',
                  value: dashboardData.upcomingDueDates?.length ?? 0,
                  bg: 'bg-warning-light',
                  fg: 'text-warning',
                },
                {
                  icon: Activity,
                  label: 'Recent Events',
                  value: dashboardData.recentActivity?.length ?? 0,
                  bg: 'bg-success-light',
                  fg: 'text-success',
                },
              ].map(({ icon: StatIcon, label, value, bg, fg }) => (
                <div
                  key={label}
                  className="rounded-xl border border-border-light bg-surface-elevated p-4 flex items-center gap-4 shadow-sm hover:shadow-md transition-all duration-150"
                >
                  <div
                    className={cn(
                      'h-10 w-10 rounded-xl flex items-center justify-center shrink-0',
                      bg,
                    )}
                  >
                    <StatIcon className={cn('h-[18px] w-[18px]', fg)} />
                  </div>
                  <div>
                    <p className="text-2xl font-[650] text-text leading-none">{value}</p>
                    <p className="text-xs text-text-tertiary mt-1">{label}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Widget grid */}
          <div className="grid gap-4 grid-cols-1 lg:grid-cols-[3fr_2fr]">
            <MyIssuesWidget issues={dashboardData?.assignedIssues ?? []} />
            <ReviewRequestsWidget prs={dashboardData?.reviewRequests ?? []} />
            <UpcomingDueDatesWidget issues={dashboardData?.upcomingDueDates ?? []} />
            <RecentActivityWidget activities={dashboardData?.recentActivity ?? []} />
          </div>

          {/* Sprint Health */}
          {teams && teams.length > 0 && firstOrg && (
            <div>
              <h2 className="text-lg font-semibold text-text mb-3">Sprint Health</h2>
              <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
                {teams.map((team) => (
                  <SprintHealthWidget
                    key={team.id}
                    teamId={team.id}
                    orgSlug={firstOrg.slug}
                    teamSlug={team.slug}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Org cards */}
          <div className="mt-4">
            <h2 className="text-lg font-semibold text-text mb-3">Organizations</h2>
            <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
              {orgs.map((org) => (
                <Link
                  key={org.id}
                  to={`/${org.slug}`}
                  className="group rounded-xl border border-border-light bg-surface-elevated overflow-hidden shadow-sm hover:shadow-md transition-all duration-150"
                >
                  <div className="h-16 bg-primary-light flex items-end px-5 pb-3">
                    <div className="h-10 w-10 rounded-lg bg-primary flex items-center justify-center shadow-sm -mb-5 ring-2 ring-surface">
                      <span className="text-on-primary text-sm font-bold">{org.name[0]}</span>
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
