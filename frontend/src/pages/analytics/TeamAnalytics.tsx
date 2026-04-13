import { useQuery } from '@tanstack/react-query';
import { Users, Clock, Timer, Archive, ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';

import { analyticsApi } from '@/api/analytics.api';
import type { Period } from '@/api/analytics.api';
import { PageLayout } from '@/components/layout/PageLayout';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import { BarChart, HeatmapChart, HorizontalBarChart } from '@/components/ui/charts';
import { PageHeader } from '@/components/ui/PageHeader';
import { PeriodSelector } from '@/components/ui/PeriodSelector';
import { AnalyticsGridSkeleton } from '@/components/ui/Skeleton';
import { Table, Thead, Tbody, Tr, TrHead, Th, Td } from '@/components/ui/Table';
import { useTeamContext } from '@/hooks/useTeamContext';
import { ageColor, formatMinutes, loadColor, PRIORITY_TEXT_COLORS } from '@/lib/analytics-utils';
import { cn } from '@/lib/utils';

/**
 *
 */
export default function TeamAnalytics() {
  const { currentTeam } = useTeamContext();
  const [period, setPeriod] = useState<Period>('30d');
  const [expandedMembers, setExpandedMembers] = useState<Set<string>>(new Set());
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());

  const { data, isLoading } = useQuery({
    queryKey: ['team-analytics', currentTeam?.id, period],
    queryFn: () => analyticsApi.teamAnalytics(currentTeam!.id, period),
    enabled: !!currentTeam?.id,
  });

  const toggleMember = (userId: string) => {
    setExpandedMembers((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const toggleProject = (slug: string) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  };

  if (isLoading || !data) {
    return <AnalyticsGridSkeleton />;
  }

  const sidebar = (
    <div className="flex flex-col gap-5">
      <PeriodSelector value={period} onChange={setPeriod} />
      <Card className="p-5">
        <p className="text-xs text-text-tertiary mb-1">Total Workload</p>
        <p className="text-2xl font-bold tabular-nums">
          {data.workload.reduce((s, w) => s + w.total, 0)}
        </p>
      </Card>
      <Card className="p-5">
        <p className="text-xs text-text-tertiary mb-1">Total Hours</p>
        <p className="text-2xl font-bold tabular-nums">{formatMinutes(data.hours.totalMinutes)}</p>
      </Card>
      <Card className="p-5">
        <p className="text-xs text-text-tertiary mb-1">Avg Lead Time</p>
        <p className="text-2xl font-bold tabular-nums">
          {data.leadTimes.length > 0
            ? `${Math.round(data.leadTimes.reduce((s, lt) => s + lt.avgLeadTimeDays, 0) / data.leadTimes.length)}d`
            : '-'}
        </p>
      </Card>
    </div>
  );

  return (
    <PageLayout sidebar={sidebar}>
      <div className="flex flex-col gap-6">
        <PageHeader title="Team Analytics">
          <div className="xl:hidden">
            <PeriodSelector value={period} onChange={setPeriod} />
          </div>
        </PageHeader>

        <div className="grid grid-cols-1 2xl:grid-cols-2 gap-6">
          {/* Workload by Member */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Users className="h-5 w-5 text-text-secondary" />
                <h3 className="h3">Workload by Member</h3>
              </div>
            </CardHeader>
            <CardContent>
              {data.workload.length === 0 ? (
                <p className="text-sm text-text-tertiary">No assigned issues found.</p>
              ) : (
                <div className="space-y-1">
                  {data.workload.map((w) => (
                    <div key={w.userId}>
                      <button
                        onClick={() => toggleMember(w.userId)}
                        className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm hover:bg-surface-secondary"
                      >
                        {expandedMembers.has(w.userId) ? (
                          <ChevronDown className="h-4 w-4 text-text-tertiary" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-text-tertiary" />
                        )}
                        <span className="flex-1 font-medium">{w.displayName}</span>
                        <span className="w-16 text-right text-text-secondary">
                          Open: {w.totalOpen}
                        </span>
                        <span className="w-24 text-right text-text-secondary">
                          In Progress: {w.totalInProgress}
                        </span>
                        <span className="w-20 text-right text-text-secondary">
                          Review: {w.totalInReview}
                        </span>
                        <span className={cn('w-16 text-right font-semibold', loadColor(w.total))}>
                          {w.total}
                        </span>
                      </button>
                      {expandedMembers.has(w.userId) && (
                        <div className="ml-8 space-y-1 pb-2">
                          {w.projects.map((p) => (
                            <div
                              key={p.projectSlug}
                              className="flex items-center gap-2 text-xs text-text-secondary"
                            >
                              <span className="flex-1">{p.projectName}</span>
                              <span className="w-16 text-right">Open: {p.open}</span>
                              <span className="w-24 text-right">In Progress: {p.inProgress}</span>
                              <span className="w-20 text-right">Review: {p.inReview}</span>
                              <span className="w-16 text-right font-medium">{p.total}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Hours by Member & Project */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Clock className="h-5 w-5 text-text-secondary" />
                <h3 className="h3">Hours by Member & Project</h3>
              </div>
            </CardHeader>
            <CardContent>
              <div className="mb-4 rounded-md bg-surface-secondary px-4 py-2 inline-block">
                <p className="text-xs text-text-tertiary">Total</p>
                <p className="text-lg font-semibold">{formatMinutes(data.hours.totalMinutes)}</p>
              </div>
              {data.hours.byMember.length > 0 && (
                <>
                  <BarChart
                    data={data.hours.byMember.map((m) => ({
                      label: m.displayName,
                      value: Math.round((m.totalMinutes / 60) * 10) / 10,
                    }))}
                    className="mb-4"
                  />
                  <HeatmapChart
                    xLabels={data.hours.byProject.map((p) => p.projectName)}
                    yLabels={data.hours.byMember.map((m) => m.displayName)}
                    data={data.hours.byMember.flatMap((m) =>
                      data.hours.byProject.map((p) => {
                        const entry = m.byProject.find((bp) => bp.projectSlug === p.projectSlug);
                        return {
                          x: p.projectName,
                          y: m.displayName,
                          value: entry?.minutes ?? 0,
                        };
                      }),
                    )}
                    formatValue={(v) => formatMinutes(v)}
                    className="mb-4"
                  />
                  <div className="overflow-x-auto">
                    <Table>
                      <Thead>
                        <TrHead>
                          <Th>Member</Th>
                          {data.hours.byProject.map((p) => (
                            <Th key={p.projectSlug} className="text-right">
                              {p.projectName}
                            </Th>
                          ))}
                          <Th className="text-right">Total</Th>
                        </TrHead>
                      </Thead>
                      <Tbody>
                        {data.hours.byMember.map((m) => (
                          <Tr key={m.userId}>
                            <Td className="font-medium">{m.displayName}</Td>
                            {data.hours.byProject.map((p) => {
                              const entry = m.byProject.find(
                                (bp) => bp.projectSlug === p.projectSlug,
                              );
                              return (
                                <Td key={p.projectSlug} className="text-right tabular-nums">
                                  {entry ? formatMinutes(entry.minutes) : '-'}
                                </Td>
                              );
                            })}
                            <Td className="text-right font-semibold tabular-nums">
                              {formatMinutes(m.totalMinutes)}
                            </Td>
                          </Tr>
                        ))}
                        <tr className="border-t border-border font-semibold">
                          <Td>Total</Td>
                          {data.hours.byProject.map((p) => (
                            <Td key={p.projectSlug} className="text-right tabular-nums">
                              {formatMinutes(p.minutes)}
                            </Td>
                          ))}
                          <Td className="text-right tabular-nums">
                            {formatMinutes(data.hours.totalMinutes)}
                          </Td>
                        </tr>
                      </Tbody>
                    </Table>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Lead Times by Project */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Timer className="h-5 w-5 text-text-secondary" />
                <h3 className="h3">Lead Times by Project</h3>
              </div>
            </CardHeader>
            <CardContent>
              {data.leadTimes.length === 0 ? (
                <p className="text-sm text-text-tertiary">No completed issues in this period.</p>
              ) : (
                <>
                  <HorizontalBarChart
                    data={data.leadTimes.map((lt) => ({
                      label: lt.projectName,
                      value: lt.avgLeadTimeDays,
                    }))}
                    formatValue={(v) => `${v}d`}
                    className="mb-4"
                  />
                  <div className="overflow-x-auto">
                    <Table>
                      <Thead>
                        <TrHead>
                          <Th>Project</Th>
                          <Th className="text-right">Avg Lead Time</Th>
                          <Th className="text-right">Completed</Th>
                          <Th className="text-right">Task</Th>
                          <Th className="text-right">Bug</Th>
                          <Th className="text-right">Story</Th>
                        </TrHead>
                      </Thead>
                      <Tbody>
                        {data.leadTimes.map((lt) => (
                          <Tr key={lt.projectSlug}>
                            <Td className="font-medium">{lt.projectName}</Td>
                            <Td className="text-right tabular-nums">{lt.avgLeadTimeDays}d</Td>
                            <Td className="text-right tabular-nums">{lt.issuesCompleted}</Td>
                            <Td className="text-right text-text-secondary tabular-nums">
                              {lt.byType.TASK
                                ? `${lt.byType.TASK.avgLeadTimeDays}d (${lt.byType.TASK.count})`
                                : '-'}
                            </Td>
                            <Td className="text-right text-text-secondary tabular-nums">
                              {lt.byType.BUG
                                ? `${lt.byType.BUG.avgLeadTimeDays}d (${lt.byType.BUG.count})`
                                : '-'}
                            </Td>
                            <Td className="text-right text-text-secondary tabular-nums">
                              {lt.byType.STORY
                                ? `${lt.byType.STORY.avgLeadTimeDays}d (${lt.byType.STORY.count})`
                                : '-'}
                            </Td>
                          </Tr>
                        ))}
                      </Tbody>
                    </Table>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Backlog by Project */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Archive className="h-5 w-5 text-text-secondary" />
                <h3 className="h3">Backlog by Project</h3>
              </div>
            </CardHeader>
            <CardContent>
              {data.backlog.length === 0 ? (
                <p className="text-sm text-text-tertiary">No backlog items found.</p>
              ) : (
                <div className="space-y-1">
                  {data.backlog.map((b) => (
                    <div key={b.projectSlug}>
                      <button
                        onClick={() => toggleProject(b.projectSlug)}
                        className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm hover:bg-surface-secondary"
                      >
                        {expandedProjects.has(b.projectSlug) ? (
                          <ChevronDown className="h-4 w-4 text-text-tertiary" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-text-tertiary" />
                        )}
                        <span className="flex-1 font-medium">{b.projectName}</span>
                        <span className="text-text-secondary">{b.backlogSize} items</span>
                        <span className="text-text-secondary">
                          {b.maintenanceCount} maintenance
                        </span>
                        <span className="text-text-secondary">{b.bugCount} bugs</span>
                        <span className={ageColor(b.oldestItemDays)}>
                          oldest: {b.oldestItemDays}d
                        </span>
                      </button>
                      {expandedProjects.has(b.projectSlug) && (
                        <div className="ml-8 space-y-1 pb-2">
                          {b.issues.map((issue) => (
                            <div key={issue.id} className="flex items-center gap-2 text-xs">
                              <span
                                className={cn('w-16', PRIORITY_TEXT_COLORS[issue.priority] ?? '')}
                              >
                                {issue.priority}
                              </span>
                              <span className="w-12 text-text-tertiary">{issue.type}</span>
                              <span className="flex-1">{issue.title}</span>
                              <span className={cn('w-12 text-right', ageColor(issue.ageDays))}>
                                {issue.ageDays}d
                              </span>
                              {issue.labels.length > 0 && (
                                <span className="text-text-tertiary">
                                  {issue.labels.join(', ')}
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </PageLayout>
  );
}
