import { useQuery } from '@tanstack/react-query';
import { Users, Clock, Timer, Archive, BarChart3, ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';

import { analyticsApi } from '@/api/analytics.api';
import type { Period } from '@/api/analytics.api';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import { PeriodSelector } from '@/components/ui/PeriodSelector';
import { useTeamContext } from '@/hooks/useTeamContext';
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

const PRIORITY_COLORS: Record<string, string> = {
  CRITICAL: 'text-[var(--color-error)]',
  HIGH: 'text-[var(--color-warning)]',
  MEDIUM: 'text-[var(--color-text-primary)]',
  LOW: 'text-[var(--color-text-tertiary)]',
};

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
    return (
      <div className="mx-auto max-w-7xl space-y-6 p-6">
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
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <BarChart3 className="h-6 w-6 text-[var(--color-text-secondary)]" />
          <h1 className="text-2xl font-semibold text-[var(--color-text-primary)]">
            {currentTeam?.name} Analytics
          </h1>
        </div>
        <PeriodSelector value={period} onChange={setPeriod} />
      </div>

      {/* Workload by Member */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-[var(--color-text-secondary)]" />
            <h2 className="text-lg font-medium">Workload by Member</h2>
          </div>
        </CardHeader>
        <CardContent>
          {data.workload.length === 0 ? (
            <p className="text-sm text-[var(--color-text-tertiary)]">No assigned issues found.</p>
          ) : (
            <div className="space-y-1">
              {data.workload.map((w) => (
                <div key={w.userId}>
                  <button
                    onClick={() => toggleMember(w.userId)}
                    className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm hover:bg-[var(--color-surface-secondary)]"
                  >
                    {expandedMembers.has(w.userId) ? (
                      <ChevronDown className="h-4 w-4 text-[var(--color-text-tertiary)]" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-[var(--color-text-tertiary)]" />
                    )}
                    <span className="flex-1 font-medium text-[var(--color-text-primary)]">
                      {w.displayName}
                    </span>
                    <span className="w-16 text-right text-[var(--color-text-secondary)]">
                      Open: {w.totalOpen}
                    </span>
                    <span className="w-24 text-right text-[var(--color-text-secondary)]">
                      In Progress: {w.totalInProgress}
                    </span>
                    <span className="w-20 text-right text-[var(--color-text-secondary)]">
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
                          className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]"
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
            <Clock className="h-5 w-5 text-[var(--color-text-secondary)]" />
            <h2 className="text-lg font-medium">Hours by Member & Project</h2>
          </div>
        </CardHeader>
        <CardContent>
          <div className="mb-4 rounded-md bg-[var(--color-surface-secondary)] px-4 py-2 inline-block">
            <p className="text-xs text-[var(--color-text-tertiary)]">Total</p>
            <p className="text-lg font-semibold text-[var(--color-text-primary)]">
              {formatMinutes(data.hours.totalMinutes)}
            </p>
          </div>
          {data.hours.byMember.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-text-secondary)]">
                  <th className="pb-2 font-medium">Member</th>
                  {data.hours.byProject.map((p) => (
                    <th key={p.projectSlug} className="pb-2 text-right font-medium">
                      {p.projectName}
                    </th>
                  ))}
                  <th className="pb-2 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {data.hours.byMember.map((m) => (
                  <tr key={m.userId} className="border-b border-[var(--color-border-subtle)]">
                    <td className="py-2 font-medium text-[var(--color-text-primary)]">
                      {m.displayName}
                    </td>
                    {data.hours.byProject.map((p) => {
                      const entry = m.byProject.find((bp) => bp.projectSlug === p.projectSlug);
                      return (
                        <td key={p.projectSlug} className="py-2 text-right">
                          {entry ? formatMinutes(entry.minutes) : '-'}
                        </td>
                      );
                    })}
                    <td className="py-2 text-right font-semibold">
                      {formatMinutes(m.totalMinutes)}
                    </td>
                  </tr>
                ))}
                <tr className="border-t border-[var(--color-border)] font-semibold">
                  <td className="py-2">Total</td>
                  {data.hours.byProject.map((p) => (
                    <td key={p.projectSlug} className="py-2 text-right">
                      {formatMinutes(p.minutes)}
                    </td>
                  ))}
                  <td className="py-2 text-right">{formatMinutes(data.hours.totalMinutes)}</td>
                </tr>
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* Lead Times by Project */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Timer className="h-5 w-5 text-[var(--color-text-secondary)]" />
            <h2 className="text-lg font-medium">Lead Times by Project</h2>
          </div>
        </CardHeader>
        <CardContent>
          {data.leadTimes.length === 0 ? (
            <p className="text-sm text-[var(--color-text-tertiary)]">
              No completed issues in this period.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-text-secondary)]">
                  <th className="pb-2 font-medium">Project</th>
                  <th className="pb-2 text-right font-medium">Avg Lead Time</th>
                  <th className="pb-2 text-right font-medium">Completed</th>
                  <th className="pb-2 text-right font-medium">Task</th>
                  <th className="pb-2 text-right font-medium">Bug</th>
                  <th className="pb-2 text-right font-medium">Story</th>
                </tr>
              </thead>
              <tbody>
                {data.leadTimes.map((lt) => (
                  <tr key={lt.projectSlug} className="border-b border-[var(--color-border-subtle)]">
                    <td className="py-2 font-medium text-[var(--color-text-primary)]">
                      {lt.projectName}
                    </td>
                    <td className="py-2 text-right">{lt.avgLeadTimeDays}d</td>
                    <td className="py-2 text-right">{lt.issuesCompleted}</td>
                    <td className="py-2 text-right text-[var(--color-text-secondary)]">
                      {lt.byType.TASK
                        ? `${lt.byType.TASK.avgLeadTimeDays}d (${lt.byType.TASK.count})`
                        : '-'}
                    </td>
                    <td className="py-2 text-right text-[var(--color-text-secondary)]">
                      {lt.byType.BUG
                        ? `${lt.byType.BUG.avgLeadTimeDays}d (${lt.byType.BUG.count})`
                        : '-'}
                    </td>
                    <td className="py-2 text-right text-[var(--color-text-secondary)]">
                      {lt.byType.STORY
                        ? `${lt.byType.STORY.avgLeadTimeDays}d (${lt.byType.STORY.count})`
                        : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* Backlog by Project */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Archive className="h-5 w-5 text-[var(--color-text-secondary)]" />
            <h2 className="text-lg font-medium">Backlog by Project</h2>
          </div>
        </CardHeader>
        <CardContent>
          {data.backlog.length === 0 ? (
            <p className="text-sm text-[var(--color-text-tertiary)]">No backlog items found.</p>
          ) : (
            <div className="space-y-1">
              {data.backlog.map((b) => (
                <div key={b.projectSlug}>
                  <button
                    onClick={() => toggleProject(b.projectSlug)}
                    className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm hover:bg-[var(--color-surface-secondary)]"
                  >
                    {expandedProjects.has(b.projectSlug) ? (
                      <ChevronDown className="h-4 w-4 text-[var(--color-text-tertiary)]" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-[var(--color-text-tertiary)]" />
                    )}
                    <span className="flex-1 font-medium text-[var(--color-text-primary)]">
                      {b.projectName}
                    </span>
                    <span className="text-[var(--color-text-secondary)]">
                      {b.backlogSize} items
                    </span>
                    <span className="text-[var(--color-text-secondary)]">
                      {b.maintenanceCount} maintenance
                    </span>
                    <span className="text-[var(--color-text-secondary)]">{b.bugCount} bugs</span>
                    <span className={cn(ageColor(b.oldestItemDays))}>
                      oldest: {b.oldestItemDays}d
                    </span>
                  </button>
                  {expandedProjects.has(b.projectSlug) && (
                    <div className="ml-8 space-y-1 pb-2">
                      {b.issues.map((issue) => (
                        <div key={issue.id} className="flex items-center gap-2 text-xs">
                          <span className={cn('w-16', PRIORITY_COLORS[issue.priority] ?? '')}>
                            {issue.priority}
                          </span>
                          <span className="w-12 text-[var(--color-text-tertiary)]">
                            {issue.type}
                          </span>
                          <span className="flex-1 text-[var(--color-text-primary)]">
                            {issue.title}
                          </span>
                          <span className={cn('w-12 text-right', ageColor(issue.ageDays))}>
                            {issue.ageDays}d
                          </span>
                          {issue.labels.length > 0 && (
                            <span className="text-[var(--color-text-tertiary)]">
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
  );
}
