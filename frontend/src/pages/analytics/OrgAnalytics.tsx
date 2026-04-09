import { useQuery } from '@tanstack/react-query';
import { Users, Clock, Timer, Archive, BarChart3, ArrowRight } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';

import { analyticsApi } from '@/api/analytics.api';
import type { Period } from '@/api/analytics.api';
import { orgsApi } from '@/api/orgs.api';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import { BarChart, HorizontalBarChart, StackedBarChart } from '@/components/ui/charts';
import { PeriodSelector } from '@/components/ui/PeriodSelector';
import { STABLE_STALE_TIME } from '@/lib/constants';
import { cn } from '@/lib/utils';

function formatMinutes(m: number): string {
  const hours = Math.floor(m / 60);
  const mins = m % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

function loadColor(total: number): string {
  if (total >= 8) return 'text-[var(--color-error)]';
  if (total >= 5) return 'text-[var(--color-warning)]';
  return 'text-[var(--color-success)]';
}

function ageColor(days: number): string {
  if (days >= 30) return 'text-[var(--color-error)]';
  if (days >= 14) return 'text-[var(--color-warning)]';
  return 'text-[var(--color-text-secondary)]';
}

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
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 animate-pulse rounded bg-[var(--color-surface-secondary)]" />
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="h-64 animate-pulse rounded-lg bg-[var(--color-surface-secondary)]"
          />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <BarChart3 className="h-6 w-6 text-[var(--color-text-secondary)]" />
          <h1 className="text-2xl font-semibold text-[var(--color-text-primary)]">
            Organization Analytics
          </h1>
        </div>
        <PeriodSelector value={period} onChange={setPeriod} />
      </div>

      {/* Workload Overview */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-[var(--color-text-secondary)]" />
            <h2 className="text-lg font-medium">Workload Overview</h2>
          </div>
        </CardHeader>
        <CardContent>
          {data.workload.length === 0 ? (
            <p className="text-sm text-[var(--color-text-tertiary)]">No assigned issues found.</p>
          ) : (
            <>
              <StackedBarChart
                data={data.workload.map((w) => ({
                  label: w.displayName,
                  segments: [
                    { value: w.open, color: 'var(--color-text-secondary)' },
                    { value: w.inProgress, color: 'var(--color-accent)' },
                    { value: w.inReview, color: 'var(--color-warning)' },
                  ],
                }))}
                segmentLabels={['Open', 'In Progress', 'In Review']}
                segmentColors={[
                  'var(--color-text-secondary)',
                  'var(--color-accent)',
                  'var(--color-warning)',
                ]}
                height={120}
                className="mb-4"
              />
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-text-secondary)]">
                    <th className="pb-2 font-medium">Member</th>
                    <th className="pb-2 font-medium">Team</th>
                    <th className="pb-2 text-right font-medium">Open</th>
                    <th className="pb-2 text-right font-medium">In Progress</th>
                    <th className="pb-2 text-right font-medium">In Review</th>
                    <th className="pb-2 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {data.workload.map((w) => (
                    <tr key={w.userId} className="border-b border-[var(--color-border-subtle)]">
                      <td className="py-2 font-medium text-[var(--color-text-primary)]">
                        {w.displayName}
                      </td>
                      <td className="py-2">
                        <Link
                          to={`/${org}/${w.teamSlug}/analytics`}
                          className="text-[var(--color-accent)] hover:underline"
                        >
                          {w.teamName}
                        </Link>
                      </td>
                      <td className="py-2 text-right">{w.open}</td>
                      <td className="py-2 text-right">{w.inProgress}</td>
                      <td className="py-2 text-right">{w.inReview}</td>
                      <td className={cn('py-2 text-right font-semibold', loadColor(w.total))}>
                        {w.total}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </CardContent>
      </Card>

      {/* Hours Spent */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-[var(--color-text-secondary)]" />
            <h2 className="text-lg font-medium">Hours Spent</h2>
          </div>
        </CardHeader>
        <CardContent>
          <div className="mb-4 flex gap-4">
            <div className="rounded-md bg-[var(--color-surface-secondary)] px-4 py-2">
              <p className="text-xs text-[var(--color-text-tertiary)]">Total</p>
              <p className="text-lg font-semibold text-[var(--color-text-primary)]">
                {formatMinutes(data.hours.totalMinutes)}
              </p>
            </div>
            {data.hours.byTeam.map((t) => (
              <div
                key={t.teamName}
                className="rounded-md bg-[var(--color-surface-secondary)] px-4 py-2"
              >
                <p className="text-xs text-[var(--color-text-tertiary)]">{t.teamName}</p>
                <p className="text-lg font-semibold text-[var(--color-text-primary)]">
                  {formatMinutes(t.minutes)}
                </p>
              </div>
            ))}
          </div>
          {data.hours.byTeam.length > 0 && (
            <BarChart
              data={data.hours.byTeam.map((t) => ({
                label: t.teamName,
                value: Math.round((t.minutes / 60) * 10) / 10,
              }))}
              height={120}
              className="mb-4"
            />
          )}
          {data.hours.byMember.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-text-secondary)]">
                  <th className="pb-2 font-medium">Member</th>
                  <th className="pb-2 font-medium">Team</th>
                  <th className="pb-2 font-medium">Project</th>
                  <th className="pb-2 text-right font-medium">Hours</th>
                </tr>
              </thead>
              <tbody>
                {data.hours.byMember.map((h, i) => (
                  <tr key={i} className="border-b border-[var(--color-border-subtle)]">
                    <td className="py-2 text-[var(--color-text-primary)]">{h.displayName}</td>
                    <td className="py-2">{h.teamName}</td>
                    <td className="py-2">{h.projectName}</td>
                    <td className="py-2 text-right font-medium">{formatMinutes(h.minutes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* Lead Times */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Timer className="h-5 w-5 text-[var(--color-text-secondary)]" />
            <h2 className="text-lg font-medium">Lead Times</h2>
          </div>
        </CardHeader>
        <CardContent>
          {data.leadTimes.length === 0 ? (
            <p className="text-sm text-[var(--color-text-tertiary)]">
              No completed issues in this period.
            </p>
          ) : (
            <>
              <table className="mb-4 w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-text-secondary)]">
                    <th className="pb-2 font-medium">Project</th>
                    <th className="pb-2 text-right font-medium">Avg Lead Time</th>
                    <th className="pb-2 text-right font-medium">Completed</th>
                    <th className="pb-2 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {data.leadTimes.map((lt) => (
                    <tr
                      key={lt.projectSlug}
                      className="border-b border-[var(--color-border-subtle)]"
                    >
                      <td className="py-2 font-medium text-[var(--color-text-primary)]">
                        {lt.projectName}
                      </td>
                      <td className="py-2 text-right">{lt.avgLeadTimeDays}d</td>
                      <td className="py-2 text-right">{lt.issuesCompleted}</td>
                      <td className="py-2 text-right">
                        <Link
                          to={`/${org}/${lt.teamSlug}/analytics`}
                          className="inline-flex items-center gap-1 text-[var(--color-accent)] hover:underline"
                        >
                          Details <ArrowRight className="h-3 w-3" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <HorizontalBarChart
                data={data.leadTimes.map((lt) => ({
                  label: lt.projectName,
                  value: lt.avgLeadTimeDays,
                }))}
                formatValue={(v) => `${v}d`}
                height={100}
              />
            </>
          )}
        </CardContent>
      </Card>

      {/* Backlog Health */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Archive className="h-5 w-5 text-[var(--color-text-secondary)]" />
            <h2 className="text-lg font-medium">Backlog Health</h2>
          </div>
        </CardHeader>
        <CardContent>
          {data.backlog.length === 0 ? (
            <p className="text-sm text-[var(--color-text-tertiary)]">No backlog items found.</p>
          ) : (
            <>
              <HorizontalBarChart
                data={data.backlog.map((b) => ({
                  label: b.projectName,
                  value: b.backlogSize,
                }))}
                height={100}
                className="mb-4"
              />
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-text-secondary)]">
                    <th className="pb-2 font-medium">Project</th>
                    <th className="pb-2 text-right font-medium">Backlog</th>
                    <th className="pb-2 text-right font-medium">Maintenance</th>
                    <th className="pb-2 text-right font-medium">Bugs</th>
                    <th className="pb-2 text-right font-medium">Oldest</th>
                  </tr>
                </thead>
                <tbody>
                  {data.backlog.map((b) => (
                    <tr
                      key={b.projectSlug}
                      className="border-b border-[var(--color-border-subtle)]"
                    >
                      <td className="py-2 font-medium text-[var(--color-text-primary)]">
                        {b.projectName}
                      </td>
                      <td className="py-2 text-right">{b.backlogSize}</td>
                      <td className="py-2 text-right">{b.maintenanceCount}</td>
                      <td className="py-2 text-right">{b.bugCount}</td>
                      <td className={cn('py-2 text-right', ageColor(b.oldestItemDays))}>
                        {b.oldestItemDays}d
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
