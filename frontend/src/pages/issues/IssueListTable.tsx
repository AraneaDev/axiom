import { AlertCircle, Search } from 'lucide-react';
import { Link } from 'react-router';

import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Checkbox } from '@/components/ui/Checkbox';
import { EmptyState } from '@/components/ui/EmptyState';
import { IssueTypeIcon } from '@/components/ui/IssueTypeIcon';
import { cn, formatRelative } from '@/lib/utils';

const PRIORITY_DOT_COLORS: Record<string, string> = {
  CRITICAL: 'bg-danger',
  HIGH: 'bg-warning',
  MEDIUM: 'bg-primary',
  LOW: 'bg-success',
  NONE: 'bg-text-tertiary',
};

const PRIORITY_BORDER_COLORS: Record<string, string> = {
  CRITICAL: 'border-l-danger',
  HIGH: 'border-l-warning',
  MEDIUM: 'border-l-primary',
  LOW: 'border-l-success',
  NONE: 'border-l-transparent',
};

interface Issue {
  id: string;
  number: number;
  key: string;
  title: string;
  type: string;
  priority: string;
  updatedAt: string;
  column?: { name: string };
  assignee?: { id: string; displayName: string };
  labels?: { id: string; name: string }[];
}

type ViewMode = 'list' | 'grid';

interface IssueListTableProps {
  issues: Issue[];
  selectedIds: Set<string>;
  toggleSelect: (id: string, e: React.MouseEvent) => void;
  toggleSelectAll: () => void;
  viewMode: ViewMode;
  hasActiveSearch: boolean;
  activeFilterCount: number;
  org: string;
  teamSlug: string;
  projectSlug: string;
  onIssueClick?: (id: string) => void;
  selectedIssueId?: string | null;
}

/**
 *
 * @param root0
 * @param root0.issues
 * @param root0.selectedIds
 * @param root0.toggleSelect
 * @param root0.toggleSelectAll
 * @param root0.viewMode
 * @param root0.hasActiveSearch
 * @param root0.activeFilterCount
 * @param root0.org
 * @param root0.teamSlug
 * @param root0.projectSlug
 * @param root0.onIssueClick
 * @param root0.selectedIssueId
 */
export function IssueListTable({
  issues,
  selectedIds,
  toggleSelect,
  toggleSelectAll,
  viewMode,
  hasActiveSearch,
  activeFilterCount,
  org,
  teamSlug,
  projectSlug,
  onIssueClick,
  selectedIssueId,
}: IssueListTableProps) {
  const hasSelection = selectedIds.size > 0;

  if (!issues.length) {
    return (
      <EmptyState
        icon={
          hasActiveSearch ? (
            <Search className="h-10 w-10 text-text-tertiary" />
          ) : (
            <AlertCircle className="h-10 w-10 text-text-tertiary" />
          )
        }
        title="No issues found"
        description={
          hasActiveSearch
            ? 'No issues match your search. Try a different query.'
            : activeFilterCount > 0
              ? 'Try adjusting your filters.'
              : 'Create your first issue to get started.'
        }
      />
    );
  }

  if (viewMode === 'list') {
    return (
      <Card className="overflow-hidden">
        {/* Select all header */}
        <div className="flex items-center gap-3 px-4 py-2 bg-surface-secondary/50 border-b border-border">
          <Checkbox
            checked={selectedIds.size === issues.length && issues.length > 0}
            onChange={toggleSelectAll}
            title="Select all"
          />
          <span className="text-xs text-text-tertiary font-medium">
            {hasSelection ? `${selectedIds.size} selected` : 'Select all'}
          </span>
        </div>
        <div className="divide-y divide-border-light">
          {issues.map((issue) => (
            <div
              key={issue.id}
              data-issue-row
              className={cn(
                'flex items-center gap-3 px-4 py-2.5 border-l-2 hover:bg-surface-tertiary transition-colors duration-150 cursor-pointer',
                PRIORITY_BORDER_COLORS[issue.priority] ?? 'border-l-transparent',
                selectedIds.has(issue.id) && 'bg-primary-light/5',
                selectedIssueId === issue.id && 'bg-primary-light/10 border-l-primary',
              )}
              onClick={() => onIssueClick?.(issue.id)}
            >
              <Checkbox
                checked={selectedIds.has(issue.id)}
                onClick={(e) => toggleSelect(issue.id, e)}
                onChange={() => {}}
                className="shrink-0"
              />
              <Link
                to={`/${org}/${teamSlug}/${projectSlug}/issues/${issue.number}`}
                className="flex items-center gap-3 flex-1 min-w-0"
              >
                <IssueTypeIcon type={issue.type} className="h-4 w-4 shrink-0" />
                <span className="text-xs text-text-tertiary font-mono w-16 shrink-0">
                  {issue.key}
                </span>
                <span className="flex-1 text-sm font-medium truncate">{issue.title}</span>
                {issue.labels?.map((l) => (
                  <Badge key={l.id} size="sm">
                    {l.name}
                  </Badge>
                ))}
                <span
                  className={cn(
                    'h-1.5 w-1.5 rounded-full shrink-0',
                    PRIORITY_DOT_COLORS[issue.priority] ?? 'bg-text-tertiary',
                  )}
                  title={issue.priority}
                />
                {issue.column && (
                  <Badge variant="outline" size="sm">
                    {issue.column.name}
                  </Badge>
                )}
                {issue.assignee && <Avatar name={issue.assignee.displayName} size="sm" />}
                <span className="text-xs text-text-tertiary w-16 text-right shrink-0">
                  {formatRelative(issue.updatedAt)}
                </span>
              </Link>
            </div>
          ))}
        </div>
      </Card>
    );
  }

  return (
    <div className="grid gap-3 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
      {issues.map((issue) => (
        <Card
          key={issue.id}
          data-issue-row
          className={cn(
            'relative p-4 hover:shadow-md hover:-translate-y-px hover:border-primary/30 transition-all duration-150 cursor-pointer',
            selectedIds.has(issue.id) && 'border-primary/50 bg-primary-light/5',
            selectedIssueId === issue.id && 'border-primary/50 bg-primary-light/10',
          )}
          onClick={() => onIssueClick?.(issue.id)}
        >
          <Checkbox
            checked={selectedIds.has(issue.id)}
            onClick={(e) => toggleSelect(issue.id, e)}
            onChange={() => {}}
            className="absolute top-3 right-3"
          />
          <Link to={`/${org}/${teamSlug}/${projectSlug}/issues/${issue.number}`} className="block">
            <div className="flex items-center gap-1.5 mb-2">
              <IssueTypeIcon type={issue.type} className="h-4 w-4" />
              <span className="text-xs text-text-tertiary font-mono">{issue.key}</span>
              <span
                className={cn(
                  'ml-auto mr-6 h-1.5 w-1.5 rounded-full',
                  PRIORITY_DOT_COLORS[issue.priority] ?? 'bg-text-tertiary',
                )}
                title={issue.priority}
              />
            </div>
            <p className="text-sm font-medium line-clamp-2 mb-3">{issue.title}</p>
            <div className="flex items-center justify-between">
              <div className="flex gap-1 flex-wrap">
                {issue.labels?.slice(0, 2).map((l) => (
                  <Badge key={l.id} size="sm">
                    {l.name}
                  </Badge>
                ))}
              </div>
              <div className="flex items-center gap-2">
                {issue.column && (
                  <Badge variant="outline" size="sm">
                    {issue.column.name}
                  </Badge>
                )}
                {issue.assignee && <Avatar name={issue.assignee.displayName} size="sm" />}
              </div>
            </div>
          </Link>
        </Card>
      ))}
    </div>
  );
}
