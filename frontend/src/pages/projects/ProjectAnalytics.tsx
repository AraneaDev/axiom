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
import { PageLayout } from '@/components/layout/PageLayout';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import { LineChart } from '@/components/ui/charts';
import { AnalyticsGridSkeleton } from '@/components/ui/Skeleton';
import { Table, Tbody, Td, Th, Thead, Tr, TrHead } from '@/components/ui/Table';
import { useProjectContext } from '@/hooks/useProjectContext';
import { cn } from '@/lib/utils';

const CHART_PRIORITY_COLORS: Record<string, string> = {
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

/**
 *
 */
export default function ProjectAnalytics() {
  const { org, teamSlug, currentProject } = useProjectContext();

  const {
    data: analytics,
    isLoading,
    error,
  } = useQuery({
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

  if (isLoading || !analytics) return <AnalyticsGridSkeleton showPeriod={false} />;

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <AlertTriangle className="h-8 w-8 text-danger mx-auto mb-2" />
          <p className="text-text-secondary">Failed to load project analytics</p>
        </div>
      </div>
    );
  }

  const maxStatusCount = Math.max(...analytics.issuesByStatus.map((s) => s.count), 1);
  const maxPriorityCount = Math.max(...analytics.issuesByPriority.map((p) => p.count), 1);

  const sidebar = (
    <div className="space-y-3">
      <h3 className="text-xs font-medium text-text-tertiary uppercase tracking-wide">Summary</h3>
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
  );

  return (
    <PageLayout sidebar={sidebar}>
      <div className="flex flex-col gap-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <BarChart3 className="h-6 w-6 text-text-secondary" />
            <h1 className="text-2xl font-semibold">{currentProject?.name} Analytics</h1>
            {currentProject?.prefix && (
              <span className="text-xs font-mono text-text-tertiary bg-surface-secondary px-1.5 py-0.5 rounded">
                {currentProject.prefix}
              </span>
            )}
          </div>
        </div>

        {/* Summary cards -- visible below xl, hidden when sidebar shows */}
        <div className="xl:hidden grid grid-cols-2 md:grid-cols-5 gap-4">
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

        {/* Issue distributions + Activity trend */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_2fr] gap-6">
          <div className="flex flex-col gap-6">
            {/* By Status */}
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5 text-text-secondary" />
                  <h2 className="text-lg font-medium">Issues by Status</h2>
                </div>
              </CardHeader>
              <CardContent>
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
                              style={{
                                width: `${(item.count / maxStatusCount) * 100}%`,
                              }}
                            />
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* By Priority */}
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5 text-text-secondary" />
                  <h2 className="text-lg font-medium">Issues by Priority</h2>
                </div>
              </CardHeader>
              <CardContent>
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
                                CHART_PRIORITY_COLORS[item.priority] ?? 'bg-primary',
                              )}
                              style={{
                                width: `${(item.count / maxPriorityCount) * 100}%`,
                              }}
                            />
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Activity trend (last 30 days) */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-text-secondary" />
                <h2 className="text-lg font-medium">Activity Trend (Last 30 Days)</h2>
              </div>
            </CardHeader>
            <CardContent>
              <LineChart
                series={[
                  {
                    label: 'Opened',
                    data: analytics.issuesOverTime.map((d) => ({
                      x: d.date.slice(5),
                      y: d.opened,
                    })),
                    color: 'var(--color-primary)',
                  },
                  {
                    label: 'Closed',
                    data: analytics.issuesOverTime.map((d) => ({
                      x: d.date.slice(5),
                      y: d.closed,
                    })),
                    color: 'var(--color-success)',
                  },
                ]}
                area={true}
                height={160}
              />
            </CardContent>
          </Card>
        </div>

        {/* Team workload */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="h-5 w-5 text-text-secondary" />
                <h2 className="text-lg font-medium">Team Workload</h2>
              </div>
              <Button variant="secondary" size="xs" onClick={handleExportAnalytics}>
                <Download className="h-3.5 w-3.5" /> Export CSV
              </Button>
            </div>
          </CardHeader>
          <CardContent>
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
                        <Tr key={member.userId}>
                          <Td>
                            <div className="flex items-center gap-2">
                              <Avatar name={member.displayName} size="sm" />
                              <Link
                                to={`/${org}/${teamSlug}/members/${member.username}`}
                                className="font-medium hover:text-primary hover:underline"
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
                        </Tr>
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
          </CardContent>
        </Card>
      </div>
    </PageLayout>
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
    <Card className="p-4">
      <div className="flex items-center gap-1.5 mb-1">
        {icon}
        <span className="text-xs text-text-secondary">{label}</span>
      </div>
      <div className="text-2xl font-bold tabular-nums">{value}</div>
    </Card>
  );
}
