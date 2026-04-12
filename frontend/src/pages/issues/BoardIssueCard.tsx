import { Link } from 'react-router';

import { PRIORITY_CARD_COLORS, TYPE_CARD_COLORS } from './board-utils';

import type { ApprovalRequest } from '@/api/approvals.api';
import { ApprovalBadge } from '@/components/ui/ApprovalBadge';
import { Avatar } from '@/components/ui/Avatar';
import { IssueTypeIcon } from '@/components/ui/IssueTypeIcon';
import { PriorityBadge } from '@/components/ui/PriorityBadge';
import type { Issue } from '@/lib/types';
import { cn } from '@/lib/utils';

/**
 *
 * @param root0
 * @param root0.issue
 * @param root0.org
 * @param root0.team
 * @param root0.project
 * @param root0.columnId
 * @param root0.onDragStart
 * @param root0.cardColorBy
 * @param root0.pendingRequest
 */
/**
 *
 * @param root0
 * @param root0.issue
 * @param root0.org
 * @param root0.team
 * @param root0.project
 * @param root0.columnId
 * @param root0.onDragStart
 * @param root0.cardColorBy
 * @param root0.pendingRequest
 */
export function BoardIssueCard({
  issue,
  org,
  team,
  project,
  columnId,
  onDragStart,
  cardColorBy,
  pendingRequest,
}: {
  issue: Issue;
  org: string;
  team: string;
  project: string;
  columnId: string;
  onDragStart: (e: React.DragEvent, issue: Issue, columnId: string) => void;
  cardColorBy?: string | null;
  pendingRequest?: ApprovalRequest | null;
}) {
  const borderColor =
    cardColorBy === 'priority'
      ? (PRIORITY_CARD_COLORS[issue.priority] ?? undefined)
      : cardColorBy === 'type'
        ? (TYPE_CARD_COLORS[issue.type] ?? undefined)
        : undefined;

  const hasPending = !!pendingRequest;

  return (
    <Link
      to={`/${org}/${team}/${project}/issues/${issue.number}`}
      draggable={!hasPending}
      onDragStart={(e) => {
        if (hasPending) {
          e.preventDefault();
          return;
        }
        e.stopPropagation();
        onDragStart(e, issue, columnId);
      }}
      className={cn(
        'block rounded-md border border-border bg-surface p-3 hover:shadow-md hover:border-primary/50 hover:bg-surface-secondary transition-all',
        hasPending ? 'cursor-default opacity-80' : 'cursor-grab active:cursor-grabbing',
      )}
      style={borderColor ? { borderLeftWidth: '4px', borderLeftColor: borderColor } : undefined}
    >
      <div className="flex items-center gap-1.5 mb-1.5">
        <IssueTypeIcon type={issue.type} className="h-3.5 w-3.5" />
        <span className="text-xs text-text-secondary font-mono">{issue.key}</span>
        <PriorityBadge priority={issue.priority} display="short" className="ml-auto" />
      </div>
      <p className="text-sm font-medium line-clamp-2 mb-2">{issue.title}</p>
      {hasPending && (
        <div className="mb-2">
          <ApprovalBadge status="PENDING" targetColumnName={pendingRequest?.targetColumn?.name} />
        </div>
      )}
      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          {issue.labels?.slice(0, 2).map((l) => (
            <span
              key={l.id}
              className="text-xs px-1.5 py-0.5 rounded bg-surface-tertiary text-text-secondary"
            >
              {l.name}
            </span>
          ))}
        </div>
        {issue.assignee && <Avatar name={issue.assignee.displayName} size="sm" />}
      </div>
    </Link>
  );
}
