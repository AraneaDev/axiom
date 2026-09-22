import { useQuery } from '@tanstack/react-query';
import {
  Plus,
  ArrowRight,
  ListChecks,
  GitPullRequest,
  Activity,
  CalendarClock,
  AlertTriangle,
} from 'lucide-react';
import { Link } from 'react-router';

import { dashboardApi } from '@/api/dashboard.api';
import type { DashboardTrends } from '@/api/dashboard.api';
import { orgsApi } from '@/api/orgs.api';
import { teamsApi } from '@/api/teams.api';
import { MarkdownRenderer } from '@/components/editor/MarkdownRenderer';
import { PageLayout } from '@/components/layout/PageLayout';
import { OnboardingWizard } from '@/components/OnboardingWizard';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Sparkline } from '@/components/ui/charts';
import { PageHeader } from '@/components/ui/PageHeader';
import { Skeleton, CardSkeleton } from '@/components/ui/Skeleton';
import { StatCard } from '@/components/ui/StatCard';
import { STABLE_STALE_TIME } from '@/lib/constants';
import { useAuthStore } from '@/stores/auth.store';

import { TeamCard } from './DashboardTeamStats';
import {
  MyIssuesWidget,
  ReviewRequestsWidget,
  UpcomingDueDatesWidget,
  RecentActivityWidget,
  SprintHealthWidget,
} from './DashboardWidgets';

/**
 *
 */
export default function Dashboard() {
  const { user } = useAuthStore();
  const {
    data: orgs,
    isLoading: orgsLoading,
    error: orgsError,
  } = useQuery({
    queryKey: ['orgs'],
    queryFn: orgsApi.list,
    staleTime: STABLE_STALE_TIME,
  });
  const {
    data: dashboardData,
    isLoading: dashLoading,
    error: dashError,
  } = useQuery({
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
      <PageLayout>
        <div className="flex flex-col gap-6">
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
      </PageLayout>
    );

  if (orgsError || dashError) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <AlertTriangle className="h-8 w-8 text-danger mx-auto mb-2" />
          <p className="text-secondary">Failed to load dashboard</p>
        </div>
      </div>
    );
  }

  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const dateStr = now.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  const activitySidebar = dashboardData ? (
    <RecentActivityWidget activities={dashboardData.recentActivity ?? []} />
  ) : null;

  return (
    <>
      <PageHeader title={`${greeting}, ${user?.displayName?.split(' ')[0]}`}>
        <p className="text-text-tertiary text-sm">{dateStr}</p>
        <Link to="/orgs/new">
          <Button variant="outline" size="sm">
            <Plus className="h-3.5 w-3.5" /> New Organization
          </Button>
        </Link>
      </PageHeader>
      <PageLayout sidebar={activitySidebar} sidebarWidth="w-88">
        <div className="flex flex-col gap-5">
          {!orgs?.length ? (
            <OnboardingWizard />
          ) : (
            <>
              {/* Quick stats */}
              {dashboardData && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  {(
                    [
                      {
                        icon: ListChecks,
                        label: 'Open Issues',
                        value: dashboardData.assignedIssues?.length ?? 0,
                        variant: 'primary' as const,
                        color: 'var(--color-primary)',
                        trendKey: 'assignedIssues' as keyof DashboardTrends,
                      },
                      {
                        icon: GitPullRequest,
                        label: 'Review Requests',
                        value: dashboardData.reviewRequests?.length ?? 0,
                        variant: 'default' as const,
                        color: 'var(--color-accent)',
                        trendKey: 'reviewRequests' as keyof DashboardTrends,
                      },
                      {
                        icon: CalendarClock,
                        label: 'Due Soon',
                        value: dashboardData.upcomingDueDates?.length ?? 0,
                        variant: 'warning' as const,
                        color: 'var(--color-warning)',
                        trendKey: 'upcomingDueDates' as keyof DashboardTrends,
                      },
                      {
                        icon: Activity,
                        label: 'Recent Events',
                        value: dashboardData.recentActivity?.length ?? 0,
                        variant: 'success' as const,
                        color: 'var(--color-success)',
                        trendKey: 'recentActivity' as keyof DashboardTrends,
                      },
                    ] as const
                  ).map(({ icon, label, value, variant, color, trendKey }) => {
                    const trend = dashboardData.trends?.[trendKey];
                    return (
                      <div key={label} className="relative">
                        <StatCard icon={icon} label={label} value={value} variant={variant} />
                        {trend && trend.length >= 2 && (
                          <div className="absolute bottom-3 right-3">
                            <Sparkline data={trend} color={color} height={24} width={64} fill />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Widget grid */}
              <div className="grid gap-4 grid-cols-1 xl:grid-cols-2">
                <MyIssuesWidget issues={dashboardData?.assignedIssues ?? []} />
                <ReviewRequestsWidget prs={dashboardData?.reviewRequests ?? []} />
                <UpcomingDueDatesWidget issues={dashboardData?.upcomingDueDates ?? []} />
                {teams &&
                  teams.length > 0 &&
                  firstOrg &&
                  teams.map((team) => (
                    <SprintHealthWidget
                      key={team.id}
                      teamId={team.id}
                      orgSlug={firstOrg.slug}
                      teamSlug={team.slug}
                    />
                  ))}
              </div>

              {/* Org cards */}
              <div>
                <h3 className="h3 mb-3">Organizations</h3>
                <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
                  {orgs.map((org) => (
                    <Link
                      key={org.id}
                      to={`/${org.slug}`}
                      className="group rounded-lg border border-border bg-surface-elevated overflow-hidden hover:shadow-md transition-all duration-150"
                    >
                      <div className="h-10 bg-primary-light flex items-end px-4 pb-2">
                        <div className="h-8 w-8 rounded-md bg-primary flex items-center justify-center shadow-sm -mb-4 ring-2 ring-surface-elevated">
                          <span className="text-text-inverse text-xs font-bold">{org.name[0]}</span>
                        </div>
                      </div>
                      <div className="p-4 pt-6">
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
                  <h3 className="h3 mb-3">Teams</h3>
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
      </PageLayout>
    </>
  );
}
