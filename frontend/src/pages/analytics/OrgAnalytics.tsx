import { useQuery } from '@tanstack/react-query';
import { Users, Clock, Timer, Archive } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';

import { analyticsApi } from '@/api/analytics.api';
import type { Period } from '@/api/analytics.api';
import { orgsApi } from '@/api/orgs.api';
import { PageLayout } from '@/components/layout/PageLayout';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import { BarChart, HorizontalBarChart, StackedBarChart } from '@/components/ui/charts';
import { PageHeader } from '@/components/ui/PageHeader';
import { PeriodSelector } from '@/components/ui/PeriodSelector';
import { AnalyticsGridSkeleton } from '@/components/ui/Skeleton';
import { Table, Thead, Tbody, Tr, TrHead, Th, Td } from '@/components/ui/Table';
import { ageColor, formatMinutes, loadColor } from '@/lib/analytics-utils';
import { STABLE_STALE_TIME } from '@/lib/constants';
import { cn } from '@/lib/utils';

/**
 *
 */
export default function OrgAnalytics() {
  const { org } = useParams();
  const [period, setPeriod] = useState<Period>('30d');

  const { data: orgs } = useQuery({
    queryKey: ['orgs'],
    queryFn: orgsApi.list,
    staleTime: STABLE_STALE_TIME,
  });
  const currentOrg = orgs?.find((o) => o.slug === org);

  const { data, isLoading } = useQuery({
    queryKey: ['org-analytics', currentOrg?.id, period],
    queryFn: () => analyticsApi.orgAnalytics(currentOrg!.id, period),
    enabled: !!currentOrg?.id,
  });

  if (isLoading || !data) {
    return <AnalyticsGridSkeleton />;
  }

  const sidebar = (
    <div className="flex flex-col gap-5">
      <PeriodSelector value={period} onChange={setPeriod} />
      <Card className="p-5">
        <p className="text-xs text-text-tertiary mb-1">Total Active Issues</p>
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
      <Card className="p-5">
        <p className="text-xs text-text-tertiary mb-1">Backlog Size</p>
        <p className="text-2xl font-bold tabular-nums">
          {data.backlog.reduce((s, b) => s + b.backlogSize, 0)}
        </p>
      </Card>
    </div>
  );

  return (
    <PageLayout sidebar={sidebar}>
      <div className="flex flex-col gap-6">
        <PageHeader title="Organization Analytics">
          <div className="xl:hidden">
            <PeriodSelector value={period} onChange={setPeriod} />
          </div>
        </PageHeader>

        <div className="grid grid-cols-1 2xl:grid-cols-2 gap-6">
          {/* Workload Overview */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Users className="h-5 w-5 text-text-secondary" />
                <h3 className="h3">Workload Overview</h3>
              </div>
            </CardHeader>
            <CardContent>
              {data.workload.length === 0 ? (
                <p className="text-sm text-text-tertiary">No assigned issues found.</p>
              ) : (
                <>
                  <StackedBarChart
                    data={data.workload.map((w) => ({
                      label: w.displayName,
                      segments: [
                        { value: w.open, color: 'var(--color-text-tertiary)' },
                        { value: w.inProgress, color: 'var(--color-primary)' },
                        { value: w.inReview, color: 'var(--color-warning)' },
                      ],
                    }))}
                    segmentLabels={['Open', 'In Progress', 'In Review']}
                    segmentColors={[
                      'var(--color-text-tertiary)',
                      'var(--color-primary)',
                      'var(--color-warning)',
                    ]}
                    className="mb-4"
                  />
                  <div className="overflow-x-auto">
                    <Table>
                      <Thead>
                        <TrHead>
                          <Th>Member</Th>
                          <Th>Team</Th>
                          <Th className="text-right">Open</Th>
                          <Th className="text-right">In Progress</Th>
                          <Th className="text-right">In Review</Th>
                          <Th className="text-right">Total</Th>
                        </TrHead>
                      </Thead>
                      <Tbody>
                        {data.workload.map((w) => (
                          <Tr key={w.userId}>
                            <Td className="font-medium">{w.displayName}</Td>
                            <Td>
                              <Link
                                to={`/${org}/${w.teamSlug}/analytics`}
                                className="hover:underline cursor-pointer"
                              >
                                {w.teamName}
                              </Link>
                            </Td>
                            <Td className="text-right tabular-nums">{w.open}</Td>
                            <Td className="text-right tabular-nums">{w.inProgress}</Td>
                            <Td className="text-right tabular-nums">{w.inReview}</Td>
                            <Td
                              className={cn(
                                'text-right font-semibold tabular-nums',
                                loadColor(w.total),
                              )}
                            >
                              {w.total}
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

          {/* Hours Spent */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Clock className="h-5 w-5 text-text-secondary" />
                <h3 className="h3">Hours Spent</h3>
              </div>
            </CardHeader>
            <CardContent>
              <div className="mb-4 flex flex-wrap gap-4">
                <div className="rounded-md bg-surface-secondary px-4 py-2">
                  <p className="text-xs text-text-tertiary">Total</p>
                  <p className="text-lg font-semibold">{formatMinutes(data.hours.totalMinutes)}</p>
                </div>
                {data.hours.byTeam.map((t) => (
                  <div key={t.teamName} className="rounded-md bg-surface-secondary px-4 py-2">
                    <p className="text-xs text-text-tertiary">{t.teamName}</p>
                    <p className="text-lg font-semibold">{formatMinutes(t.minutes)}</p>
                  </div>
                ))}
              </div>
              {data.hours.byTeam.length > 0 && (
                <BarChart
                  data={data.hours.byTeam.map((t) => ({
                    label: t.teamName,
                    value: Math.round((t.minutes / 60) * 10) / 10,
                  }))}
                  className="mb-4"
                />
              )}
              {data.hours.byMember.length > 0 && (
                <div className="overflow-x-auto">
                  <Table>
                    <Thead>
                      <TrHead>
                        <Th>Member</Th>
                        <Th>Team</Th>
                        <Th>Project</Th>
                        <Th className="text-right">Hours</Th>
                      </TrHead>
                    </Thead>
                    <Tbody>
                      {data.hours.byMember.map((h, i) => (
                        <Tr key={i}>
                          <Td className="font-medium">{h.displayName}</Td>
                          <Td>
                            <Link
                              to={`/${org}/${h.teamSlug}/analytics`}
                              className="hover:underline cursor-pointer"
                            >
                              {h.teamName}
                            </Link>
                          </Td>
                          <Td>
                            <Link
                              to={`/${org}/${h.teamSlug}/${h.projectSlug}/analytics`}
                              className="hover:underline cursor-pointer"
                            >
                              {h.projectName}
                            </Link>
                          </Td>
                          <Td className="text-right tabular-nums">{formatMinutes(h.minutes)}</Td>
                        </Tr>
                      ))}
                    </Tbody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Lead Times */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Timer className="h-5 w-5 text-text-secondary" />
                <h3 className="h3">Lead Times</h3>
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
                        </TrHead>
                      </Thead>
                      <Tbody>
                        {data.leadTimes.map((lt) => (
                          <Tr key={lt.projectSlug}>
                            <Td className="font-medium">
                              <Link
                                to={`/${org}/${lt.teamSlug}/${lt.projectSlug}/analytics`}
                                className="hover:underline cursor-pointer"
                              >
                                {lt.projectName}
                              </Link>
                            </Td>
                            <Td className="text-right tabular-nums">{lt.avgLeadTimeDays}d</Td>
                            <Td className="text-right tabular-nums">{lt.issuesCompleted}</Td>
                          </Tr>
                        ))}
                      </Tbody>
                    </Table>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Backlog Health */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Archive className="h-5 w-5 text-text-secondary" />
                <h3 className="h3">Backlog Health</h3>
              </div>
            </CardHeader>
            <CardContent>
              {data.backlog.length === 0 ? (
                <p className="text-sm text-text-tertiary">No backlog items found.</p>
              ) : (
                <>
                  <HorizontalBarChart
                    data={data.backlog.map((b) => ({
                      label: b.projectName,
                      value: b.backlogSize,
                    }))}
                    className="mb-4"
                  />
                  <div className="overflow-x-auto">
                    <Table>
                      <Thead>
                        <TrHead>
                          <Th>Project</Th>
                          <Th className="text-right">Backlog</Th>
                          <Th className="text-right">Maintenance</Th>
                          <Th className="text-right">Bugs</Th>
                          <Th className="text-right">Oldest</Th>
                        </TrHead>
                      </Thead>
                      <Tbody>
                        {data.backlog.map((b) => (
                          <Tr key={b.projectSlug}>
                            <Td className="font-medium">
                              <Link
                                to={`/${org}/${b.teamSlug}/${b.projectSlug}/analytics`}
                                className="hover:underline cursor-pointer"
                              >
                                {b.projectName}
                              </Link>
                            </Td>
                            <Td className="text-right tabular-nums">{b.backlogSize}</Td>
                            <Td className="text-right tabular-nums">{b.maintenanceCount}</Td>
                            <Td className="text-right tabular-nums">{b.bugCount}</Td>
                            <Td
                              className={cn('text-right tabular-nums', ageColor(b.oldestItemDays))}
                            >
                              {b.oldestItemDays}d
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
        </div>
      </div>
    </PageLayout>
  );
}
