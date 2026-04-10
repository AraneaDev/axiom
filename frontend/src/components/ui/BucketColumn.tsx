import { type DragEvent, useState, useCallback } from 'react';

import { RoadmapCard } from './RoadmapCard';

import type { TimelineIssue } from '@/api/roadmap.api';
import { cn } from '@/lib/utils';

interface BucketColumnProps {
  name: string;
  color?: string;
  issues: TimelineIssue[];
  projectPrefix: string;
  onDropIssue: (issueId: string) => void;
  onIssueClick: (issue: TimelineIssue) => void;
}

/**
 * Droppable column in the roadmap bucket board.
 * Displays a header with color dot, name, and issue count.
 * Issues render as RoadmapCards within a scrollable area.
 * @param root0
 * @param root0.name
 * @param root0.color
 * @param root0.issues
 * @param root0.projectPrefix
 * @param root0.onDropIssue
 * @param root0.onIssueClick
 */
export function BucketColumn({
  name,
  color,
  issues,
  projectPrefix,
  onDropIssue,
  onIssueClick,
}: BucketColumnProps) {
  const [dragOver, setDragOver] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOver(true);
  }

  function handleDragLeave(e: DragEvent<HTMLDivElement>) {
    // Only leave if we actually left the column (not entering a child)
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragOver(false);
    }
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const issueId = e.dataTransfer.getData('text/plain');
    if (issueId) {
      onDropIssue(issueId);
    }
  }

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={cn(
        'flex flex-col w-72 min-w-[18rem] shrink-0 rounded-lg border bg-surface-secondary/50 transition-colors duration-150',
        dragOver ? 'border-primary bg-primary-light/30' : 'border-border',
      )}
    >
      {/* Column header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border">
        {color && (
          <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
        )}
        <h3 className="text-sm font-medium text-text truncate">{name}</h3>
        <span className="ml-auto text-xs text-text-tertiary tabular-nums">{issues.length}</span>
      </div>

      {/* Scrollable card list */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2 min-h-[120px]">
        {issues.map((issue) => (
          <RoadmapCard
            key={issue.id}
            issue={issue}
            projectPrefix={projectPrefix}
            isExpanded={expandedIds.has(issue.id)}
            onToggleExpand={() => toggleExpand(issue.id)}
            onClick={onIssueClick}
          />
        ))}
        {issues.length === 0 && (
          <p className="text-xs text-text-tertiary text-center py-8">Drag issues here</p>
        )}
      </div>
    </div>
  );
}
