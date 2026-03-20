import { useQuery } from '@tanstack/react-query';
import { BarChart3, CheckCircle2, Circle, Clock, ListChecks, Timer, Users } from 'lucide-react';
import { useParams } from 'react-router';

import { orgsApi } from '@/api/orgs.api';
import { projectsApi } from '@/api/projects.api';
import { teamsApi } from '@/api/teams.api';
import { Avatar } from '@/components/ui/Avatar';
import { Progress } from '@/components/ui/Progress';
import { Skeleton } from '@/components/ui/Skeleton';
import { STABLE_STALE_TIME } from '@/lib/constants';
import { cn } from '@/lib/utils';

const PRIORITY_COLORS: Record<string, string> = {
  URGENT: 'bg-danger',
  HIGH: 'bg-warning',
  MEDIUM: 'bg-primary',
  LOW: 'bg-text-tertiary',
  NONE: 'bg-border',
};

const PRIORITY_LABELS: Record<string, string> = {
  URGENT: 'Urgent',
  HIGH: 'High',
  MEDIUM: 'Medium',
  LOW: 'Low',
  NONE: 'None',
};

function AnalyticsSkeleton() {
  return (
    <div className="max-w-7xl mx-auto space-y-8">
      <div>
        <Skeleton className="h-7 w-48 mb-2" />
        <Skeleton className="h-4 w-64" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-border bg-surface p-4">
            <Skeleton className="h-3 w-20 mb-2" />
            <Skeleton className="h-8 w-16" />
          </div>
        ))}
      </div>
      <div className="grid md:grid-cols-2 gap-6">
        <div className="rounded-lg border border-border bg-surface p-5">
          <Skeleton className="h-5 w-32 mb-4" />
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-6 w-full mb-3" />
          ))}
        </div>
        <div className="rounded-lg border border-border bg-surface p-5">
          <Skeleton className="h-5 w-32 mb-4" />
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-6 w-full mb-3" />
          ))}
        </div>
      </div>
      <div className="rounded-lg border border-border bg-surface p-5">
        <Skeleton className="h-5 w-40 mb-4" />
        <Skeleton className="h-40 w-full" />
      </div>
    </div>
  );
}

/**
 *
 */
export default function ProjectAnalytics() {
  const { org, team: teamSlug, project: projectSlug } = useParams();

  const { data: orgs } = useQuery({
    queryKey: ['orgs'],
    queryFn: orgsApi.list,
    staleTime: STABLE_STALE_TIME,
  });
  const currentOrg = orgs?.find((o) => o.slug === org);

  const { data: teams } = useQuery({
    queryKey: ['teams', currentOrg?.id],
    queryFn: () => teamsApi.listByOrg(currentOrg!.id),
    enabled: !!currentOrg?.id,
    staleTime: STABLE_STALE_TIME,
  });
  const currentTeam = teams?.find((t) => t.slug === teamSlug);

  const { data: projects } = useQuery({
    queryKey: ['projects', currentTeam?.id],
    queryFn: () => projectsApi.listByTeam(currentTeam!.id),
    enabled: !!currentTeam?.id,
  });
  const currentProject = projects?.find((p) => p.slug === projectSlug);

  const { data: analytics, isLoading } = useQuery({
    queryKey: ['project-analytics', currentProject?.id],
    queryFn: () => projectsApi.analytics(currentProject!.id),
    enabled: !!currentProject?.id,
  });

  if (isLoading || !analytics) return <AnalyticsSkeleton />;

  const maxStatusCount = Math.max(...analytics.issuesByStatus.map((s) => s.count), 1);
  const maxPriorityCount = Math.max(...analytics.issuesByPriority.map((p) => p.count), 1);
  const maxDayActivity = Math.max(
    ...analytics.issuesOverTime.map((d) => Math.max(d.opened, d.closed)),
    1,
  );

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <BarChart3 className="h-6 w-6 text-primary" />
          {currentProject?.name} Analytics
        </h1>
        <p className="text-sm text-text-secondary mt-1">
          Project performance overview and issue metrics
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <SummaryCard
          icon={<ListChecks className="h-4 w-4 text-primary" />}
          label="Total Issues"
          value={analytics.totalIssues}
        />
        <SummaryCard
          icon={<Circle className="h-4 w-4 text-warning" />}
          label="Open"
          value={analytics.openCount}
        />
        <SummaryCard
          icon={<CheckCircle2 className="h-4 w-4 text-success" />}
          label="Closed"
          value={analytics.closedCount}
        />
        <SummaryCard
          icon={<Timer className="h-4 w-4 text-primary" />}
          label="Avg Cycle Time"
          value={`${analytics.avgCycleTime}d`}
        />
        <SummaryCard
          icon={<Clock className="h-4 w-4 text-text-secondary" />}
          label="Avg Lead Time"
          value={`${analytics.avgLeadTime}d`}
        />
      </div>

      {/* Issue distributions */}
      <div className="grid md:grid-cols-2 gap-6">
        {/* By Status */}
        <div className="rounded-lg border border-border bg-surface p-5">
          <h2 className="text-sm font-semibold text-text mb-4 flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-text-secondary" />
            Issues by Status
          </h2>
          {analytics.issuesByStatus.length === 0 ? (
            <p className="text-sm text-text-tertiary">No issues yet</p>
          ) : (
            <div className="space-y-3">
              {analytics.issuesByStatus
                .sort((a, b) => b.count - a.count)
                .map((item) => (
                  <div key={item.status}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm text-text-secondary">{item.status}</span>
                      <span className="text-sm font-medium tabular-nums">{item.count}</span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-surface-tertiary overflow-hidden">
                      <div
                        className={cn(
                          'h-full rounded-full transition-all duration-500',
                          item.isDone
                            ? 'bg-success'
                            : 'bg-gradient-to-r from-primary to-primary-hover',
                        )}
                        style={{ width: `${(item.count / maxStatusCount) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>

        {/* By Priority */}
        <div className="rounded-lg border border-border bg-surface p-5">
          <h2 className="text-sm font-semibold text-text mb-4 flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-text-secondary" />
            Issues by Priority
          </h2>
          {analytics.issuesByPriority.length === 0 ? (
            <p className="text-sm text-text-tertiary">No issues yet</p>
          ) : (
            <div className="space-y-3">
              {analytics.issuesByPriority
                .sort((a, b) => {
                  const order = ['URGENT', 'HIGH', 'MEDIUM', 'LOW', 'NONE'];
                  return order.indexOf(a.priority) - order.indexOf(b.priority);
                })
                .map((item) => (
                  <div key={item.priority}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm text-text-secondary">
                        {PRIORITY_LABELS[item.priority] ?? item.priority}
                      </span>
                      <span className="text-sm font-medium tabular-nums">{item.count}</span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-surface-tertiary overflow-hidden">
                      <div
                        className={cn(
                          'h-full rounded-full transition-all duration-500',
                          PRIORITY_COLORS[item.priority] ?? 'bg-primary',
                        )}
                        style={{ width: `${(item.count / maxPriorityCount) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>
      </div>

      {/* Activity trend (last 30 days) */}
      <div className="rounded-lg border border-border bg-surface p-5">
        <h2 className="text-sm font-semibold text-text mb-4 flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-text-secondary" />
          Activity Trend (Last 30 Days)
        </h2>
        <div className="flex items-center gap-4 mb-3 text-xs text-text-secondary">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-sm bg-primary" /> Opened
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-sm bg-success" /> Closed
          </span>
        </div>
        <div className="flex items-end gap-px h-32">
          {analytics.issuesOverTime.map((day) => (
            <div
              key={day.date}
              className="flex-1 flex flex-col items-center justify-end gap-px h-full group relative"
            >
              {/* Opened bar */}
              <div
                className="w-full rounded-t-sm bg-primary transition-all duration-300 min-h-0"
                style={{
                  height: day.opened > 0 ? `${(day.opened / maxDayActivity) * 50}%` : '0',
                }}
              />
              {/* Closed bar */}
              <div
                className="w-full rounded-t-sm bg-success transition-all duration-300 min-h-0"
                style={{
                  height: day.closed > 0 ? `${(day.closed / maxDayActivity) * 50}%` : '0',
                }}
              />
              {/* Tooltip */}
              <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 hidden group-hover:block z-10">
                <div className="bg-surface-elevated border border-border rounded-md shadow-lg px-2 py-1 text-xs whitespace-nowrap">
                  <div className="font-medium text-text">{day.date}</div>
                  <div className="text-text-secondary">
                    Opened: {day.opened} / Closed: {day.closed}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
        {/* X-axis labels */}
        <div className="flex justify-between mt-1 text-[10px] text-text-tertiary">
          <span>{analytics.issuesOverTime[0]?.date.slice(5) ?? ''}</span>
          <span>
            {analytics.issuesOverTime[Math.floor(analytics.issuesOverTime.length / 2)]?.date.slice(
              5,
            ) ?? ''}
          </span>
          <span>
            {analytics.issuesOverTime[analytics.issuesOverTime.length - 1]?.date.slice(5) ?? ''}
          </span>
        </div>
      </div>

      {/* Team workload */}
      <div className="rounded-lg border border-border bg-surface p-5">
        <h2 className="text-sm font-semibold text-text mb-4 flex items-center gap-2">
          <Users className="h-4 w-4 text-text-secondary" />
          Team Workload
        </h2>
        {analytics.memberWorkload.length === 0 ? (
          <p className="text-sm text-text-tertiary">No assigned issues</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-text-secondary text-left">
                  <th className="pb-2 font-medium">Member</th>
                  <th className="pb-2 font-medium text-right">Assigned</th>
                  <th className="pb-2 font-medium text-right">Completed</th>
                  <th className="pb-2 font-medium w-48">Completion</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-light">
                {analytics.memberWorkload.map((member) => {
                  const rate =
                    member.assignedCount > 0
                      ? Math.round((member.completedCount / member.assignedCount) * 100)
                      : 0;
                  return (
                    <tr key={member.userId}>
                      <td className="py-2.5">
                        <div className="flex items-center gap-2">
                          <Avatar name={member.displayName} size="sm" />
                          <span className="font-medium text-text">{member.displayName}</span>
                        </div>
                      </td>
                      <td className="py-2.5 text-right tabular-nums">{member.assignedCount}</td>
                      <td className="py-2.5 text-right tabular-nums">{member.completedCount}</td>
                      <td className="py-2.5">
                        <div className="flex items-center gap-2">
                          <Progress
                            value={rate}
                            size="sm"
                            variant={rate >= 75 ? 'success' : rate >= 40 ? 'primary' : 'warning'}
                          />
                          <span className="text-xs text-text-secondary tabular-nums w-8 text-right">
                            {rate}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="flex items-center gap-1.5 mb-1">
        {icon}
        <span className="text-xs text-text-secondary">{label}</span>
      </div>
      <div className="text-2xl font-bold tabular-nums">{value}</div>
    </div>
  );
}
