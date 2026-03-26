import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Plus, Calendar } from 'lucide-react';
import { useState, useMemo } from 'react';
import { Link, useParams } from 'react-router';

import { issuesApi } from '@/api/issues.api';
import { orgsApi } from '@/api/orgs.api';
import { projectsApi } from '@/api/projects.api';
import { teamsApi } from '@/api/teams.api';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { IssueTypeIcon } from '@/components/ui/IssueTypeIcon';
import { Skeleton } from '@/components/ui/Skeleton';
import { PRIORITY_COLORS } from '@/lib/constants';
import type { RoadmapEpic, Issue } from '@/lib/types';
import { cn } from '@/lib/utils';

function formatMonth(date: Date) {
  return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

function EpicBar({
  epic,
  timelineStart,
  totalDays,
  org,
  teamSlug,
  projectSlug,
}: {
  epic: RoadmapEpic;
  timelineStart: Date;
  totalDays: number;
  org: string;
  teamSlug: string;
  projectSlug: string;
}) {
  const [expanded, setExpanded] = useState(false);

  const startOffset = Math.max(
    0,
    (new Date(epic.startDate).getTime() - timelineStart.getTime()) / 86400000,
  );
  const endOffset = Math.min(
    totalDays,
    (new Date(epic.endDate).getTime() - timelineStart.getTime()) / 86400000,
  );
  const barWidth = Math.max(2, endOffset - startOffset);

  const leftPct = (startOffset / totalDays) * 100;
  const widthPct = (barWidth / totalDays) * 100;

  return (
    <div className="mb-1">
      {/* Epic row */}
      <div className="flex items-stretch border-b border-border-light hover:bg-surface-secondary/50 transition-colors">
        {/* Label column */}
        <div className="w-72 shrink-0 flex items-center gap-2 px-3 py-2 border-r border-border-light">
          <Button
            variant="ghost"
            size="xs"
            onClick={() => setExpanded(!expanded)}
            title={expanded ? 'Collapse' : 'Expand'}
            className="p-0.5"
          >
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
          </Button>
          <IssueTypeIcon type="EPIC" className="h-4 w-4 shrink-0" />
          <Link
            to={`/${org}/${teamSlug}/${projectSlug}/issues/${epic.number}`}
            className="text-sm font-medium truncate hover:text-primary transition-colors"
          >
            {epic.key} {epic.title}
          </Link>
          <span className="ml-auto text-xs text-text-tertiary shrink-0">
            {epic.progress.completed}/{epic.progress.total}
          </span>
        </div>

        {/* Timeline column */}
        <div className="flex-1 relative min-h-[40px]">
          <div
            className="absolute top-1/2 -translate-y-1/2 h-6 rounded-full bg-primary-light border border-primary/20 overflow-hidden"
            style={{ left: `${leftPct}%`, width: `${widthPct}%`, minWidth: '24px' }}
          >
            <div
              className="h-full bg-primary rounded-full transition-all duration-300"
              style={{ width: `${epic.progress.percentage}%` }}
            />
          </div>
          {/* Percentage label */}
          {widthPct > 5 && (
            <div
              className="absolute top-1/2 -translate-y-1/2 text-[10px] font-medium text-primary pointer-events-none"
              style={{ left: `${leftPct + widthPct / 2}%`, transform: 'translate(-50%, -50%)' }}
            >
              {epic.progress.percentage}%
            </div>
          )}
        </div>
      </div>

      {/* Expanded children */}
      {expanded && epic.children && epic.children.length > 0 && (
        <div className="bg-surface-secondary/30">
          {(epic.children as Issue[]).map((child) => {
            const childStart = new Date(child.createdAt);
            const childEnd = child.dueDate
              ? new Date(child.dueDate)
              : new Date(childStart.getTime() + 7 * 86400000);
            const cStartOff = Math.max(
              0,
              (childStart.getTime() - timelineStart.getTime()) / 86400000,
            );
            const cEndOff = Math.min(
              totalDays,
              (childEnd.getTime() - timelineStart.getTime()) / 86400000,
            );
            const cBarWidth = Math.max(1, cEndOff - cStartOff);
            const cLeftPct = (cStartOff / totalDays) * 100;
            const cWidthPct = (cBarWidth / totalDays) * 100;
            const isDone = child.column?.isDone;

            return (
              <div
                key={child.id}
                className="flex items-stretch border-b border-border-light/50 hover:bg-surface-secondary transition-colors"
              >
                <div className="w-72 shrink-0 flex items-center gap-2 pl-10 pr-3 py-1.5 border-r border-border-light">
                  <IssueTypeIcon type={child.type} className="h-3.5 w-3.5 shrink-0" />
                  <Link
                    to={`/${org}/${teamSlug}/${projectSlug}/issues/${child.number}`}
                    className={cn(
                      'text-xs truncate hover:text-primary transition-colors',
                      isDone && 'line-through text-text-tertiary',
                    )}
                  >
                    {child.key} {child.title}
                  </Link>
                  <span
                    className={`ml-auto text-[10px] px-1.5 py-0.5 rounded-full shrink-0 ${PRIORITY_COLORS[child.priority]}`}
                  >
                    {child.priority[0]}
                  </span>
                </div>
                <div className="flex-1 relative min-h-[32px]">
                  <div
                    className={cn(
                      'absolute top-1/2 -translate-y-1/2 h-4 rounded-full',
                      isDone
                        ? 'bg-success/30 border border-success/40'
                        : 'bg-surface-tertiary border border-border',
                    )}
                    style={{ left: `${cLeftPct}%`, width: `${cWidthPct}%`, minWidth: '12px' }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 *
 */
export default function Roadmap() {
  const { org, team: teamSlug, project: projectSlug } = useParams();

  const { data: orgs } = useQuery({ queryKey: ['orgs'], queryFn: orgsApi.list });
  const currentOrg = orgs?.find((o) => o.slug === org);
  const { data: teams } = useQuery({
    queryKey: ['teams', currentOrg?.id],
    queryFn: () => teamsApi.listByOrg(currentOrg!.id),
    enabled: !!currentOrg?.id,
  });
  const currentTeam = teams?.find((t) => t.slug === teamSlug);
  const { data: projects } = useQuery({
    queryKey: ['projects', currentTeam?.id],
    queryFn: () => projectsApi.listByTeam(currentTeam!.id),
    enabled: !!currentTeam?.id,
  });
  const currentProject = projects?.find((p) => p.slug === projectSlug);

  const { data: epics = [], isLoading } = useQuery({
    queryKey: ['roadmap', currentProject?.id],
    queryFn: () => issuesApi.getRoadmap(currentProject!.id),
    enabled: !!currentProject?.id,
  });

  // Compute timeline bounds
  const { timelineStart, timelineEnd, totalDays, weekMarkers } = useMemo(() => {
    if (!epics.length) {
      const now = new Date();
      const start = new Date(now);
      start.setDate(start.getDate() - 7);
      const end = new Date(now);
      end.setDate(end.getDate() + 90);
      return { timelineStart: start, timelineEnd: end, totalDays: 97, weekMarkers: [] as Date[] };
    }

    const allStarts = epics.map((e) => new Date(e.startDate).getTime());
    const allEnds = epics.map((e) => new Date(e.endDate).getTime());
    const minTime = Math.min(...allStarts);
    const maxTime = Math.max(...allEnds);

    // Add padding: 1 week before, 2 weeks after
    const start = new Date(minTime - 7 * 86400000);
    const end = new Date(maxTime + 14 * 86400000);
    const days = Math.ceil((end.getTime() - start.getTime()) / 86400000);

    // Generate week markers
    const markers: Date[] = [];
    const cursor = new Date(start);
    cursor.setDate(cursor.getDate() - cursor.getDay()); // align to Sunday
    while (cursor.getTime() <= end.getTime()) {
      if (cursor.getTime() >= start.getTime()) {
        markers.push(new Date(cursor));
      }
      cursor.setDate(cursor.getDate() + 7);
    }

    return { timelineStart: start, timelineEnd: end, totalDays: days, weekMarkers: markers };
  }, [epics]);

  // Month headers
  const monthHeaders = useMemo(() => {
    const months: { label: string; leftPct: number; widthPct: number }[] = [];
    if (totalDays <= 0) return months;

    const cursor = new Date(timelineStart);
    cursor.setDate(1);
    if (cursor.getTime() < timelineStart.getTime()) {
      cursor.setMonth(cursor.getMonth() + 1);
    }

    let prevPct = 0;
    while (cursor.getTime() <= timelineEnd.getTime()) {
      const pct = ((cursor.getTime() - timelineStart.getTime()) / (totalDays * 86400000)) * 100;
      if (months.length > 0) {
        months[months.length - 1].widthPct = pct - prevPct;
      }
      months.push({ label: formatMonth(cursor), leftPct: pct, widthPct: 0 });
      prevPct = pct;
      cursor.setMonth(cursor.getMonth() + 1);
    }
    if (months.length > 0) {
      months[months.length - 1].widthPct = 100 - prevPct;
    }

    return months;
  }, [timelineStart, timelineEnd, totalDays]);

  // Today marker
  const todayPct = useMemo(() => {
    const now = new Date();
    const pct = ((now.getTime() - timelineStart.getTime()) / (totalDays * 86400000)) * 100;
    return pct >= 0 && pct <= 100 ? pct : null;
  }, [timelineStart, totalDays]);

  if (isLoading)
    return (
      <div className="px-6 py-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <Skeleton className="h-7 w-48 mb-2" />
            <Skeleton className="h-4 w-32" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-8 w-20 rounded-md" />
            <Skeleton className="h-8 w-20 rounded-md" />
            <Skeleton className="h-8 w-28 rounded-md" />
          </div>
        </div>
        <div className="rounded-lg border border-border bg-surface overflow-hidden">
          <div className="flex border-b border-border bg-surface-secondary">
            <Skeleton className="w-72 h-10 shrink-0" />
            <Skeleton className="flex-1 h-10" />
          </div>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex border-b border-border-light">
              <div className="w-72 shrink-0 px-3 py-3">
                <Skeleton className="h-4 w-48" />
              </div>
              <div className="flex-1 py-3 px-4">
                <div
                  className="h-6 animate-pulse rounded-full bg-surface-tertiary"
                  style={{ width: `${40 + i * 12}%`, marginLeft: `${i * 8}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    );

  return (
    <div className="px-6 py-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">{currentProject?.name} Roadmap</h1>
          {currentProject?.prefix && (
            <span className="text-xs font-mono text-text-tertiary bg-surface-secondary px-1.5 py-0.5 rounded">
              {currentProject.prefix}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Link to={`/${org}/${teamSlug}/${projectSlug}/issues/new`}>
            <Button size="sm">
              <Plus className="h-4 w-4" /> New Issue
            </Button>
          </Link>
        </div>
      </div>

      {epics.length === 0 ? (
        <EmptyState
          title="No epics yet"
          description="Create issues with type Epic to see them on the roadmap timeline."
        />
      ) : (
        <div className="rounded-lg border border-border bg-surface overflow-hidden">
          {/* Header */}
          <div className="flex border-b border-border bg-surface-secondary">
            <div className="w-72 shrink-0 px-3 py-2 text-xs font-semibold text-text-secondary uppercase border-r border-border-light flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5" /> Epics
            </div>
            <div className="flex-1 relative overflow-hidden">
              {/* Month headers */}
              <div className="flex h-full">
                {monthHeaders.map((m, i) => (
                  <div
                    key={i}
                    className="text-[10px] text-text-tertiary font-medium px-2 py-2 border-r border-border-light/50 truncate"
                    style={{ width: `${m.widthPct}%`, minWidth: 0 }}
                  >
                    {m.label}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Timeline body */}
          <div className="relative">
            {/* Week grid lines */}
            {weekMarkers.map((w, i) => {
              const pct = ((w.getTime() - timelineStart.getTime()) / (totalDays * 86400000)) * 100;
              return (
                <div
                  key={i}
                  className="absolute top-0 bottom-0 border-l border-border-light/30 pointer-events-none z-0"
                  style={{ left: `calc(288px + (100% - 288px) * ${pct / 100})` }}
                />
              );
            })}

            {/* Today line */}
            {todayPct !== null && (
              <div
                className="absolute top-0 bottom-0 border-l-2 border-danger/50 pointer-events-none z-10"
                style={{ left: `calc(288px + (100% - 288px) * ${todayPct / 100})` }}
              >
                <div className="absolute -top-0.5 -left-1.5 w-3 h-3 rounded-full bg-danger/50" />
              </div>
            )}

            {/* Epic rows */}
            {epics.map((epic) => (
              <EpicBar
                key={epic.id}
                epic={epic}
                timelineStart={timelineStart}
                totalDays={totalDays}
                org={org!}
                teamSlug={teamSlug!}
                projectSlug={projectSlug!}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
