import { ChevronDown, ChevronRight, GripVertical } from 'lucide-react';
import { type DragEvent, useState } from 'react';

import { Avatar } from './Avatar';
import { IssueTypeIcon } from './IssueTypeIcon';
import { PriorityBadge } from './PriorityBadge';
import { ProgressBar } from './ProgressBar';

import type { TimelineIssue } from '@/api/roadmap.api';
import { cn } from '@/lib/utils';

interface RoadmapCardProps {
  issue: TimelineIssue;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
  onClick: (issue: TimelineIssue) => void;
  projectPrefix: string;
}

/**
 * Draggable card for the roadmap bucket view.
 * Shows issue key, type icon, priority, title, and assignee avatar.
 * Epics with children display an expand/collapse toggle and a progress bar.
 * @param root0
 * @param root0.issue
 * @param root0.isExpanded
 * @param root0.onToggleExpand
 * @param root0.onClick
 * @param root0.projectPrefix
 */
export function RoadmapCard({
  issue,
  isExpanded,
  onToggleExpand,
  onClick,
  projectPrefix,
}: RoadmapCardProps) {
  const [dragging, setDragging] = useState(false);
  const isEpic = issue.type === 'EPIC';
  const hasChildren = issue._count.children > 0;
  const showExpand = isEpic && hasChildren;

  const childrenCount = issue.children?.length ?? issue._count.children;
  const doneCount =
    issue.children?.filter((c) => c.column?.name?.toLowerCase() === 'done').length ?? 0;
  const progressPct = childrenCount > 0 ? Math.round((doneCount / childrenCount) * 100) : 0;

  function handleDragStart(e: DragEvent<HTMLDivElement>) {
    e.dataTransfer.setData('text/plain', issue.id);
    e.dataTransfer.effectAllowed = 'move';
    setDragging(true);
  }

  function handleDragEnd() {
    setDragging(false);
  }

  return (
    <div className="space-y-0.5">
      <div
        draggable
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onClick={() => onClick(issue)}
        className={cn(
          'group rounded-lg border border-border bg-surface p-2.5 cursor-pointer transition-all duration-150',
          'hover:border-border-focus hover:shadow-sm',
          dragging && 'opacity-50 shadow-lg',
        )}
      >
        {/* Top row: drag handle + type icon + key + priority */}
        <div className="flex items-center gap-1.5 mb-1.5">
          <GripVertical className="h-3.5 w-3.5 text-text-tertiary opacity-0 group-hover:opacity-100 shrink-0 cursor-grab" />
          <IssueTypeIcon type={issue.type} className="h-3.5 w-3.5 shrink-0" />
          <span className="text-xs font-medium text-text-secondary">
            {projectPrefix}-{issue.number}
          </span>
          <PriorityBadge priority={issue.priority} display="short" className="ml-auto" />
        </div>

        {/* Title */}
        <p className="text-sm text-text leading-snug line-clamp-2">{issue.title}</p>

        {/* Bottom row: expand toggle (for epics) + assignee */}
        <div className="flex items-center gap-2 mt-2">
          {showExpand && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleExpand?.();
              }}
              className="flex items-center gap-1 text-xs text-text-tertiary hover:text-text transition-colors"
              title={isExpanded ? 'Collapse children' : 'Expand children'}
            >
              {isExpanded ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
              <span>
                {childrenCount} child{childrenCount !== 1 ? 'ren' : ''}
              </span>
            </button>
          )}
          <div className="ml-auto">
            {issue.assignee && (
              <Avatar
                name={issue.assignee.displayName}
                src={issue.assignee.avatarUrl ?? undefined}
                size="xs"
              />
            )}
          </div>
        </div>

        {/* Progress bar for epics with children */}
        {showExpand && (
          <div className="mt-2">
            <ProgressBar value={progressPct} className="h-1" />
            <span className="text-[10px] text-text-tertiary mt-0.5 block">{progressPct}%</span>
          </div>
        )}
      </div>

      {/* Expanded children list */}
      {isExpanded && issue.children && issue.children.length > 0 && (
        <div className="ml-3 space-y-0.5">
          {issue.children.map((child) => (
            <div
              key={child.id}
              onClick={(e) => {
                e.stopPropagation();
                onClick(child);
              }}
              className="flex items-center gap-2 rounded-md border border-border-light bg-surface-secondary px-2 py-1.5 cursor-pointer hover:bg-surface-tertiary transition-colors"
            >
              <IssueTypeIcon type={child.type} className="h-3 w-3 shrink-0" />
              <span className="text-[11px] font-medium text-text-secondary">
                {projectPrefix}-{child.number}
              </span>
              <span className="text-xs text-text truncate">{child.title}</span>
              <PriorityBadge
                priority={child.priority}
                display="short"
                className="ml-auto text-[10px]"
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
