import { ShieldCheck } from 'lucide-react';
import { useMemo } from 'react';

import { applyFilters, groupIssues } from './board-utils';
import type { Filters, GroupBy } from './BoardFilters';
import { BoardIssueCard } from './BoardIssueCard';
import { BoardSwimLaneSection } from './BoardSwimLane';

import type { ApprovalRequest } from '@/api/approvals.api';
import type { BoardColumn as BoardColumnType, Issue } from '@/lib/types';
import { cn } from '@/lib/utils';

/**
 *
 * @param root0
 * @param root0.column
 * @param root0.org
 * @param root0.team
 * @param root0.project
 * @param root0.onDragStart
 * @param root0.onDragOver
 * @param root0.onDrop
 * @param root0.dragOverColumnId
 * @param root0.dragSourceColumnId
 * @param root0.groupBy
 * @param root0.filters
 * @param root0.cardColorBy
 * @param root0.pendingRequests
 * @param root0.isGatedInbound
 */
export function BoardColumn({
  column,
  org,
  team,
  project,
  onDragStart,
  onDragOver,
  onDrop,
  dragOverColumnId,
  dragSourceColumnId,
  groupBy,
  filters,
  cardColorBy,
  pendingRequests,
  isGatedInbound,
}: {
  column: BoardColumnType;
  org: string;
  team: string;
  project: string;
  onDragStart: (e: React.DragEvent, issue: Issue, columnId: string) => void;
  onDragOver: (e: React.DragEvent, columnId: string) => void;
  onDrop: (e: React.DragEvent, columnId: string) => void;
  dragOverColumnId: string | null;
  dragSourceColumnId: string | null;
  groupBy: GroupBy;
  filters: Filters;
  cardColorBy?: string | null;
  pendingRequests?: Map<string, ApprovalRequest>;
  isGatedInbound?: boolean;
}) {
  const isOver = dragOverColumnId === column.id;
  const isDragging = dragSourceColumnId !== null;
  const isSource = dragSourceColumnId === column.id;
  const isValidTarget = isDragging && !isSource;
  const filteredIssues = useMemo(
    () => applyFilters(column.issues, filters),
    [column.issues, filters],
  );
  const lanes = useMemo(() => groupIssues(filteredIssues, groupBy), [filteredIssues, groupBy]);
  const isOverWipLimit =
    column.wipLimit !== null &&
    column.wipLimit !== undefined &&
    filteredIssues.length > column.wipLimit;

  return (
    <div className="flex flex-col w-72 shrink-0">
      <div
        className={cn(
          'flex items-center justify-between mb-2 px-1 rounded',
          isOverWipLimit && 'border border-danger bg-danger/5',
        )}
      >
        <div className="flex items-center gap-2">
          {isGatedInbound && (
            <span title="Gated column -- approval required">
              <ShieldCheck className="h-3.5 w-3.5 text-warning" />
            </span>
          )}
          <h3 className="text-sm font-semibold text-text">{column.name}</h3>
          <span
            className={cn(
              'text-xs bg-surface-tertiary rounded-full px-1.5',
              isOverWipLimit ? 'text-danger font-semibold' : 'text-text-secondary',
            )}
          >
            {column.wipLimit != null
              ? `${filteredIssues.length} / ${column.wipLimit}`
              : filteredIssues.length}
          </span>
        </div>
      </div>
      <div
        onDragOver={(e) => onDragOver(e, column.id)}
        onDrop={(e) => onDrop(e, column.id)}
        className={cn(
          'flex-1 rounded-lg bg-surface-secondary p-2 min-h-[200px] transition-all duration-150',
          column.isDone && !isDragging && 'opacity-60',
          isValidTarget &&
            !isOver &&
            'ring-2 ring-primary/30 border-dashed border-2 border-primary/30',
          isOver && 'ring-2 ring-primary bg-primary/10 scale-[1.02] shadow-lg',
          isSource && isDragging && 'opacity-40 scale-[0.98]',
        )}
      >
        {lanes.map((lane) => (
          <BoardSwimLaneSection key={lane.key} lane={lane}>
            {lane.issues.map((issue) => (
              <BoardIssueCard
                key={issue.id}
                issue={issue}
                org={org}
                team={team}
                project={project}
                columnId={column.id}
                onDragStart={onDragStart}
                cardColorBy={cardColorBy}
                pendingRequest={pendingRequests?.get(issue.id) ?? null}
              />
            ))}
          </BoardSwimLaneSection>
        ))}
      </div>
    </div>
  );
}
