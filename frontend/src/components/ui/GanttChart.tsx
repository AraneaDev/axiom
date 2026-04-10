import { useCallback, useMemo, useState } from 'react';

import { DependencyOverlay } from './DependencyOverlay';
import { GanttRow, GanttRowLabel } from './GanttRow';
import { GanttTimeAxis } from './GanttTimeAxis';
import type { ZoomLevel } from './TimelineZoom';

import { patch, del, post } from '@/api/client';
import type { DependencyLink, TimelineIssue } from '@/api/roadmap.api';

const MS_PER_DAY = 86_400_000;
const ROW_HEIGHT = 36;
const SIDEBAR_WIDTH = 208; // w-52 = 13rem = 208px
const BUFFER_DAYS = 14;

const ZOOM_DAY_WIDTH: Record<ZoomLevel, number> = {
  weeks: 40,
  months: 12,
  quarters: 4,
};

interface GanttChartProps {
  issues: TimelineIssue[];
  links: DependencyLink[];
  zoom: ZoomLevel;
  projectPrefix: string;
  projectId: string;
  onIssueClick: (issue: TimelineIssue) => void;
}

interface FlatRow {
  issue: TimelineIssue;
  indent: number;
  isEpic: boolean;
  childCount: number;
}

/**
 * Main Gantt chart container that orchestrates the time axis, issue bars,
 * dependency arrows, and left sidebar with issue labels.
 * @param root0
 * @param root0.issues
 * @param root0.links
 * @param root0.zoom
 * @param root0.projectPrefix
 * @param root0.projectId
 * @param root0.onIssueClick
 */
export function GanttChart({
  issues,
  links,
  zoom,
  projectPrefix,
  projectId,
  onIssueClick,
}: GanttChartProps) {
  const dayWidth = ZOOM_DAY_WIDTH[zoom];
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // Flatten issues into rows with expand/collapse
  const flatRows = useMemo<FlatRow[]>(() => {
    const rows: FlatRow[] = [];
    for (const issue of issues) {
      const isEpic = issue.type === 'EPIC';
      const childCount = issue._count?.children ?? 0;
      rows.push({ issue, indent: 0, isEpic, childCount });

      if (isEpic && expandedIds.has(issue.id) && issue.children) {
        for (const child of issue.children) {
          rows.push({
            issue: child,
            indent: 1,
            isEpic: child.type === 'EPIC',
            childCount: child._count?.children ?? 0,
          });
        }
      }
    }
    return rows;
  }, [issues, expandedIds]);

  // Compute view range from all issues
  const { viewStartDate, totalDays } = useMemo(() => {
    let minTime = Infinity;
    let maxTime = -Infinity;

    const collectDates = (list: TimelineIssue[]) => {
      for (const issue of list) {
        if (issue.startDate) {
          const t = new Date(issue.startDate).getTime();
          if (t < minTime) minTime = t;
          if (t > maxTime) maxTime = t;
        }
        if (issue.dueDate) {
          const t = new Date(issue.dueDate).getTime();
          if (t < minTime) minTime = t;
          if (t > maxTime) maxTime = t;
        }
        if (issue.children) collectDates(issue.children);
      }
    };

    collectDates(issues);

    if (!isFinite(minTime)) {
      // No dates at all: show current month
      const now = new Date();
      minTime = now.getTime();
      maxTime = now.getTime() + 30 * MS_PER_DAY;
    }

    const startMs = minTime - BUFFER_DAYS * MS_PER_DAY;
    const endMs = maxTime + BUFFER_DAYS * MS_PER_DAY;
    const days = Math.ceil((endMs - startMs) / MS_PER_DAY);

    return {
      viewStartDate: new Date(startMs),
      totalDays: Math.max(days, 60),
    };
  }, [issues]);

  const totalWidth = totalDays * dayWidth;
  const totalHeight = flatRows.length * ROW_HEIGHT;

  // Build issue positions map for dependency overlay
  const issuePositions = useMemo(() => {
    const map = new Map<string, { x: number; y: number; width: number }>();
    flatRows.forEach((row, idx) => {
      const issue = row.issue;
      const y = idx * ROW_HEIGHT + (ROW_HEIGHT - 28) / 2;

      if (issue.startDate && issue.dueDate) {
        const sd = new Date(issue.startDate);
        const dd = new Date(issue.dueDate);
        const x = ((sd.getTime() - viewStartDate.getTime()) / MS_PER_DAY) * dayWidth;
        const width = ((dd.getTime() - sd.getTime()) / MS_PER_DAY) * dayWidth;
        map.set(issue.id, { x, y, width: Math.max(width, 8) });
      } else if (issue.dueDate) {
        const dd = new Date(issue.dueDate);
        const x = ((dd.getTime() - viewStartDate.getTime()) / MS_PER_DAY) * dayWidth;
        map.set(issue.id, { x: x - 6, y, width: 12 });
      } else if (issue.startDate) {
        const sd = new Date(issue.startDate);
        const x = ((sd.getTime() - viewStartDate.getTime()) / MS_PER_DAY) * dayWidth;
        map.set(issue.id, { x, y, width: dayWidth * 7 });
      }
    });
    return map;
  }, [flatRows, viewStartDate, dayWidth]);

  const handleToggleExpand = useCallback((issueId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(issueId)) {
        next.delete(issueId);
      } else {
        next.add(issueId);
      }
      return next;
    });
  }, []);

  const handleDateChange = useCallback(
    (issueId: string, startDate?: string | null, dueDate?: string | null) => {
      // Find the issue to get its number
      const findIssue = (list: TimelineIssue[]): TimelineIssue | undefined => {
        for (const iss of list) {
          if (iss.id === issueId) return iss;
          if (iss.children) {
            const found = findIssue(iss.children);
            if (found) return found;
          }
        }
        return undefined;
      };

      const issue = findIssue(issues);
      if (!issue) return;

      const data: Record<string, string | null> = {};
      if (startDate !== undefined) data.startDate = startDate;
      if (dueDate !== undefined) data.dueDate = dueDate;

      patch(`/projects/${projectId}/issues/${issue.number}`, data).catch(() => {
        // Silently fail -- the UI will revert on next fetch
      });
    },
    [issues, projectId],
  );

  const handleDeleteLink = useCallback(
    (linkId: string) => {
      // Find any issue to use its number for the API path
      const link = links.find((l) => l.id === linkId);
      if (!link) return;

      const findIssue = (list: TimelineIssue[]): TimelineIssue | undefined => {
        for (const iss of list) {
          if (iss.id === link.fromId) return iss;
          if (iss.children) {
            const found = findIssue(iss.children);
            if (found) return found;
          }
        }
        return undefined;
      };

      const issue = findIssue(issues);
      if (!issue) return;

      del(`/projects/${projectId}/issues/${issue.number}/links/${linkId}`).catch(() => {
        // Silently fail
      });
    },
    [links, issues, projectId],
  );

  const handleCreateLink = useCallback(
    (fromId: string, toId: string) => {
      const findIssue = (list: TimelineIssue[]): TimelineIssue | undefined => {
        for (const iss of list) {
          if (iss.id === fromId) return iss;
          if (iss.children) {
            const found = findIssue(iss.children);
            if (found) return found;
          }
        }
        return undefined;
      };

      const fromIssue = findIssue(issues);
      const toIssue = issues.find((i) => i.id === toId);
      if (!fromIssue || !toIssue) return;

      post(`/projects/${projectId}/issues/${fromIssue.number}/links`, {
        targetProjectId: projectId,
        targetIssueNumber: toIssue.number,
        type: 'BLOCKS',
      }).catch(() => {
        // Silently fail
      });
    },
    [issues, projectId],
  );

  return (
    <div className="flex h-full overflow-hidden bg-surface border border-border rounded-lg">
      {/* Left: Issue labels column (sticky) */}
      <div
        className="shrink-0 border-r border-border overflow-y-auto bg-surface"
        style={{ width: SIDEBAR_WIDTH }}
      >
        {/* Header spacer */}
        <div className="h-8 border-b border-border flex items-center px-2">
          <span className="text-xs font-medium text-text-secondary">Issues</span>
        </div>
        <div className="relative" style={{ height: totalHeight }}>
          {flatRows.map((row, idx) => (
            <GanttRowLabel
              key={row.issue.id}
              issue={row.issue}
              y={idx * ROW_HEIGHT}
              rowHeight={ROW_HEIGHT}
              isEpic={row.isEpic}
              isExpanded={expandedIds.has(row.issue.id)}
              childCount={row.childCount}
              onToggleExpand={handleToggleExpand}
              onClick={onIssueClick}
              projectPrefix={projectPrefix}
              indent={row.indent}
            />
          ))}
        </div>
      </div>

      {/* Right: Gantt area */}
      <div className="flex-1 overflow-auto relative">
        <GanttTimeAxis
          startDate={viewStartDate}
          totalDays={totalDays}
          dayWidth={dayWidth}
          zoom={zoom}
        />
        <div className="relative" style={{ width: totalWidth, minHeight: totalHeight }}>
          {/* Row background stripes */}
          {flatRows.map((_, idx) => (
            <div
              key={idx}
              className={idx % 2 === 0 ? 'bg-surface' : 'bg-surface-secondary/30'}
              style={{
                position: 'absolute',
                top: idx * ROW_HEIGHT,
                left: 0,
                right: 0,
                height: ROW_HEIGHT,
              }}
            />
          ))}

          {/* Today line */}
          <TodayLine viewStartDate={viewStartDate} dayWidth={dayWidth} height={totalHeight} />

          {/* Issue bars */}
          {flatRows.map((row, idx) => {
            const hasDate = row.issue.startDate || row.issue.dueDate;
            if (!hasDate) return null;
            return (
              <GanttRow
                key={row.issue.id}
                issue={row.issue}
                dayWidth={dayWidth}
                viewStartDate={viewStartDate}
                y={idx * ROW_HEIGHT}
                rowHeight={ROW_HEIGHT}
                isExpanded={expandedIds.has(row.issue.id)}
                onToggleExpand={handleToggleExpand}
                onDateChange={handleDateChange}
                onClick={onIssueClick}
                projectPrefix={projectPrefix}
              />
            );
          })}

          {/* Dependency arrows overlay */}
          <svg
            className="absolute inset-0 pointer-events-none"
            style={{ width: totalWidth, height: totalHeight }}
          >
            <g className="pointer-events-auto">
              <DependencyOverlay
                links={links}
                issuePositions={issuePositions}
                onDeleteLink={handleDeleteLink}
                onCreateLink={handleCreateLink}
              />
            </g>
          </svg>
        </div>
      </div>
    </div>
  );
}

// -- Today line indicator --

function TodayLine({
  viewStartDate,
  dayWidth,
  height,
}: {
  viewStartDate: Date;
  dayWidth: number;
  height: number;
}) {
  const now = new Date();
  const x = ((now.getTime() - viewStartDate.getTime()) / MS_PER_DAY) * dayWidth;
  if (x < 0) return null;

  return (
    <div
      className="absolute top-0 w-px bg-danger z-[5]"
      style={{ left: x, height }}
      title="Today"
    />
  );
}
