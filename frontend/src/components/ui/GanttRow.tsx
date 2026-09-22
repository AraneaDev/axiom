import { ChevronDown, ChevronRight } from 'lucide-react';
import { useCallback, useRef } from 'react';

import type { TimelineIssue } from '@/api/roadmap.api';

import { GanttBar } from './GanttBar';
import { GanttMilestone } from './GanttMilestone';

const MS_PER_DAY = 86_400_000;

/** Default colors by issue type using CSS variable tokens. */
const TYPE_COLORS: Record<string, string> = {
  EPIC: 'var(--color-primary)',
  STORY: 'var(--color-success)',
  BUG: 'var(--color-danger)',
  TASK: 'var(--color-info, var(--color-primary))',
};

interface GanttRowProps {
  issue: TimelineIssue;
  dayWidth: number;
  viewStartDate: Date;
  y: number;
  rowHeight: number;
  isExpanded: boolean;
  onToggleExpand: (issueId: string) => void;
  onDateChange: (issueId: string, startDate?: string | null, dueDate?: string | null) => void;
  onClick: (issue: TimelineIssue) => void;
  projectPrefix: string;
}

function dateToPx(date: Date, viewStart: Date, dayWidth: number): number {
  return ((date.getTime() - viewStart.getTime()) / MS_PER_DAY) * dayWidth;
}

function pxToMs(px: number, dayWidth: number): number {
  return (px / dayWidth) * MS_PER_DAY;
}

function toISODate(date: Date): string {
  return date.toISOString().split('T')[0];
}

/**
 * Single issue row in the Gantt chart. Renders a GanttBar for date ranges
 * or a GanttMilestone for issues with only a dueDate.
 * For epics, shows an expand toggle and calculates progress from children.
 * @param root0
 * @param root0.issue
 * @param root0.dayWidth
 * @param root0.viewStartDate
 * @param root0.y
 * @param root0.rowHeight
 * @param root0.isExpanded
 * @param root0.onToggleExpand
 * @param root0.onDateChange
 * @param root0.onClick
 * @param root0.projectPrefix
 */
export function GanttRow({
  issue,
  dayWidth,
  viewStartDate,
  y,
  rowHeight,
  isExpanded,
  onToggleExpand,
  onDateChange,
  onClick,
  projectPrefix,
}: GanttRowProps) {
  const startDateRef = useRef<Date | null>(issue.startDate ? new Date(issue.startDate) : null);
  const dueDateRef = useRef<Date | null>(issue.dueDate ? new Date(issue.dueDate) : null);

  const color = TYPE_COLORS[issue.type] ?? 'var(--color-primary)';
  const hasStart = !!issue.startDate;
  const hasDue = !!issue.dueDate;

  const isEpic = issue.type === 'EPIC';
  let progress: number | undefined;
  if (isEpic && issue.children && issue.children.length > 0) {
    const done = issue.children.filter((c) => c.column?.isDone === true).length;
    progress = Math.round((done / issue.children.length) * 100);
  }

  const handleMove = useCallback(
    (deltaX: number) => {
      const deltaMs = pxToMs(deltaX, dayWidth);
      if (startDateRef.current) {
        startDateRef.current = new Date(startDateRef.current.getTime() + deltaMs);
      }
      if (dueDateRef.current) {
        dueDateRef.current = new Date(dueDateRef.current.getTime() + deltaMs);
      }
      onDateChange(
        issue.id,
        startDateRef.current ? toISODate(startDateRef.current) : null,
        dueDateRef.current ? toISODate(dueDateRef.current) : null,
      );
    },
    [dayWidth, issue.id, onDateChange],
  );

  const handleResizeStart = useCallback(
    (deltaX: number) => {
      const deltaMs = pxToMs(deltaX, dayWidth);
      if (startDateRef.current) {
        startDateRef.current = new Date(startDateRef.current.getTime() + deltaMs);
        onDateChange(issue.id, toISODate(startDateRef.current), undefined);
      }
    },
    [dayWidth, issue.id, onDateChange],
  );

  const handleResizeEnd = useCallback(
    (deltaX: number) => {
      const deltaMs = pxToMs(deltaX, dayWidth);
      if (dueDateRef.current) {
        dueDateRef.current = new Date(dueDateRef.current.getTime() + deltaMs);
        onDateChange(issue.id, undefined, toISODate(dueDateRef.current));
      }
    },
    [dayWidth, issue.id, onDateChange],
  );

  const handleClick = useCallback(() => onClick(issue), [onClick, issue]);

  const rows: React.ReactNode[] = [];

  if (hasStart && hasDue) {
    const sd = new Date(issue.startDate!);
    const dd = new Date(issue.dueDate!);
    const barX = dateToPx(sd, viewStartDate, dayWidth);
    const barWidth = dateToPx(dd, viewStartDate, dayWidth) - barX;

    rows.push(
      <GanttBar
        key={issue.id}
        x={barX}
        width={barWidth}
        y={y + (rowHeight - 28) / 2}
        color={color}
        label={`${projectPrefix}-${issue.number} ${issue.title}`}
        progress={progress}
        onClick={handleClick}
        onMove={handleMove}
        onResizeStart={handleResizeStart}
        onResizeEnd={handleResizeEnd}
      />,
    );
  } else if (hasDue) {
    const dd = new Date(issue.dueDate!);
    const mX = dateToPx(dd, viewStartDate, dayWidth);

    rows.push(
      <GanttMilestone
        key={issue.id}
        x={mX}
        y={y + (rowHeight - 28) / 2}
        color={color}
        label={`${projectPrefix}-${issue.number} ${issue.title}`}
        onClick={handleClick}
      />,
    );
  } else if (hasStart) {
    // Only start date: render a narrow bar
    const sd = new Date(issue.startDate!);
    const barX = dateToPx(sd, viewStartDate, dayWidth);

    rows.push(
      <GanttBar
        key={issue.id}
        x={barX}
        width={dayWidth * 7}
        y={y + (rowHeight - 28) / 2}
        color={color}
        label={`${projectPrefix}-${issue.number} ${issue.title}`}
        progress={progress}
        onClick={handleClick}
        onMove={handleMove}
        onResizeStart={handleResizeStart}
        onResizeEnd={handleResizeEnd}
      />,
    );
  }

  // Render expanded children below
  if (isEpic && isExpanded && issue.children) {
    issue.children.forEach((child, idx) => {
      const childY = y + rowHeight * (idx + 1);
      rows.push(
        <GanttRow
          key={child.id}
          issue={child}
          dayWidth={dayWidth}
          viewStartDate={viewStartDate}
          y={childY}
          rowHeight={rowHeight}
          isExpanded={false}
          onToggleExpand={onToggleExpand}
          onDateChange={onDateChange}
          onClick={onClick}
          projectPrefix={projectPrefix}
        />,
      );
    });
  }

  return <>{rows}</>;
}

// -- Label component for the left sidebar --

interface GanttRowLabelProps {
  issue: TimelineIssue;
  y: number;
  rowHeight: number;
  isEpic: boolean;
  isExpanded: boolean;
  childCount: number;
  onToggleExpand: (issueId: string) => void;
  onClick: (issue: TimelineIssue) => void;
  projectPrefix: string;
  indent?: number;
}

/**
 * Label shown in the left sidebar column for a Gantt row.
 * @param root0
 * @param root0.issue
 * @param root0.y
 * @param root0.rowHeight
 * @param root0.isEpic
 * @param root0.isExpanded
 * @param root0.childCount
 * @param root0.onToggleExpand
 * @param root0.onClick
 * @param root0.projectPrefix
 * @param root0.indent
 */
export function GanttRowLabel({
  issue,
  y,
  rowHeight,
  isEpic,
  isExpanded,
  childCount,
  onToggleExpand,
  onClick,
  projectPrefix,
  indent = 0,
}: GanttRowLabelProps) {
  const ExpandIcon = isExpanded ? ChevronDown : ChevronRight;

  return (
    <div
      className="absolute flex items-center gap-1 px-2 text-xs truncate cursor-pointer hover:bg-surface-secondary transition-colors"
      style={{
        top: y,
        height: rowHeight,
        left: 0,
        right: 0,
        paddingLeft: 8 + indent * 16,
      }}
      title={`${projectPrefix}-${issue.number} ${issue.title}`}
      onClick={() => onClick(issue)}
    >
      {isEpic && childCount > 0 && (
        <button
          type="button"
          className="shrink-0 p-0.5 rounded hover:bg-surface-tertiary"
          onClick={(e) => {
            e.stopPropagation();
            onToggleExpand(issue.id);
          }}
          title={isExpanded ? 'Collapse' : 'Expand'}
        >
          <ExpandIcon className="h-3 w-3 text-text-secondary" />
        </button>
      )}
      <span className="text-text-tertiary shrink-0">
        {projectPrefix}-{issue.number}
      </span>
      <span className="text-text truncate">{issue.title}</span>
    </div>
  );
}
