import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Circle,
  Clock,
  Download,
  ListChecks,
  Timer,
  Users,
} from 'lucide-react';
import { Link } from 'react-router';

import { projectsApi } from '@/api/projects.api';
import { useProjectContext } from '@/hooks/useProjectContext';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { Skeleton } from '@/components/ui/Skeleton';
import { Table, Tbody, Td, Th, Thead, TrHead } from '@/components/ui/Table';
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
    <div className="space-y-8">
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
  const { org, teamSlug, currentProject } = useProjectContext();

  const { data: analytics, isLoading } = useQuery({
    queryKey: ['project-analytics', currentProject?.id],
    queryFn: () => projectsApi.analytics(currentProject!.id),
    enabled: !!currentProject?.id,
  });

  function handleExportAnalytics() {
    if (!analytics) return;
    const rows = [
      ['Member', 'Assigned', 'In Progress', 'Completed'],
      ...analytics.memberWorkload.map((m) => [
        m.displayName,
        m.assignedCount.toString(),
        m.inProgressCount.toString(),
        m.completedCount.toString(),
      ]),
    ];
    const csv = rows.map((r) => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentProject?.name ?? 'project'}-analytics.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (isLoading || !analytics) return <AnalyticsSkeleton />;

  const maxStatusCount = Math.max(...analytics.issuesByStatus.map((s) => s.count), 1);
  const maxPriorityCount = Math.max(...analytics.issuesByPriority.map((p) => p.count), 1);
  const maxDayActivity = Math.max(
    ...analytics.issuesOverTime.map((d) => Math.max(d.opened, d.closed)),
    1,
  );

  return (
    <div className="space-y-8 px-6 py-4">
      {/* Header */}
      <PageHeader title={`${currentProject?.name} Analytics`} prefix={currentProject?.prefix} />

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
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-text flex items-center gap-2">
            <Users className="h-4 w-4 text-text-secondary" />
            Team Workload
          </h2>
          <Button variant="secondary" size="xs" onClick={handleExportAnalytics}>
            <Download className="h-3.5 w-3.5" /> Export CSV
          </Button>
        </div>
        {analytics.memberWorkload.length === 0 ? (
          <p className="text-sm text-text-tertiary">No assigned issues</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <Thead>
                <TrHead>
                  <Th>Member</Th>
                  <Th className="text-right">Assigned</Th>
                  <Th className="text-right">In Progress</Th>
                  <Th className="text-right">Completed</Th>
                  <Th className="w-56">Load Distribution</Th>
                </TrHead>
              </Thead>
              <Tbody>
                {analytics.memberWorkload.map((member) => {
                  const openCount =
                    member.assignedCount - member.inProgressCount - member.completedCount;
                  const isOverloaded = member.assignedCount - member.completedCount >= 10;
                  return (
                    <tr key={member.userId}>
                      <Td>
                        <div className="flex items-center gap-2">
                          <Avatar name={member.displayName} size="sm" />
                          <Link
                            to={`/${org}/${teamSlug}/members/${member.username}`}
                            className="font-medium text-text hover:text-primary hover:underline"
                          >
                            {member.displayName}
                          </Link>
                          {isOverloaded && (
                            <span title="High workload">
                              <AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0" />
                            </span>
                          )}
                        </div>
                      </Td>
                      <Td className="text-right tabular-nums">{member.assignedCount}</Td>
                      <Td className="text-right tabular-nums">{member.inProgressCount}</Td>
                      <Td className="text-right tabular-nums">{member.completedCount}</Td>
                      <Td>
                        {member.assignedCount > 0 ? (
                          <div className="flex items-center gap-2">
                            <div className="flex-1 flex h-3 rounded-full overflow-hidden bg-surface-tertiary">
                              <div
                                className="bg-success transition-all"
                                style={{
                                  width: `${(member.completedCount / member.assignedCount) * 100}%`,
                                }}
                                title={`Completed: ${member.completedCount}`}
                              />
                              <div
                                className="bg-primary transition-all"
                                style={{
                                  width: `${(member.inProgressCount / member.assignedCount) * 100}%`,
                                }}
                                title={`In Progress: ${member.inProgressCount}`}
                              />
                              <div
                                className={cn(
                                  'transition-all',
                                  isOverloaded ? 'bg-warning' : 'bg-border',
                                )}
                                style={{
                                  width: `${(openCount / member.assignedCount) * 100}%`,
                                }}
                                title={`Open: ${openCount}`}
                              />
                            </div>
                          </div>
                        ) : (
                          <span className="text-xs text-text-tertiary">--</span>
                        )}
                      </Td>
                    </tr>
                  );
                })}
              </Tbody>
            </Table>
            <div className="flex items-center gap-4 mt-3 text-xs text-text-secondary">
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-3 rounded-sm bg-success" /> Completed
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-3 rounded-sm bg-primary" /> In Progress
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-3 rounded-sm bg-border" /> Open
              </span>
              <span className="flex items-center gap-1.5">
                <AlertTriangle className="h-3 w-3 text-warning" /> 10+ active issues
              </span>
            </div>
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
