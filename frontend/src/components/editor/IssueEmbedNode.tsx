import { type NodeViewProps, NodeViewWrapper } from '@tiptap/react';
import {
  CircleDot,
  Bug,
  BookOpen,
  CheckSquare,
  Layers,
  AlertTriangle,
  ArrowUp,
  ArrowDown,
  Minus,
  Loader2,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';

import { get } from '@/api/client';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import type { SearchResult, SearchResultItem } from '@/lib/types';
import { cn } from '@/lib/utils';

/** Map issue type strings to Lucide icon components. */
const TYPE_ICONS: Record<string, typeof CircleDot> = {
  BUG: Bug,
  STORY: BookOpen,
  TASK: CheckSquare,
  EPIC: Layers,
};

/** Map priority strings to icon + color. */
const PRIORITY_CONFIG: Record<string, { icon: typeof ArrowUp; className: string }> = {
  CRITICAL: { icon: AlertTriangle, className: 'text-danger' },
  HIGH: { icon: ArrowUp, className: 'text-danger' },
  MEDIUM: { icon: Minus, className: 'text-warning' },
  LOW: { icon: ArrowDown, className: 'text-success' },
};

/**
 * Map status strings to badge variant styles.
 * @param status
 */
function statusBadgeClass(status: string): string {
  const s = status.toUpperCase();
  if (s === 'OPEN' || s === 'IN PROGRESS' || s === 'TO DO') return 'bg-primary/15 text-primary';
  if (s === 'DONE' || s === 'MERGED' || s === 'PUBLISHED') return 'bg-success/15 text-success';
  if (s === 'CLOSED' || s === 'DRAFT') return 'bg-muted text-muted-foreground';
  return 'bg-muted text-muted-foreground';
}

interface IssueData {
  key: string;
  title: string;
  status: string;
  priority: string;
  type: string;
  url: string;
  assignee?: { displayName: string; avatarUrl?: string };
}

/**
 * Block React node view rendering a live issue embed card.
 * Fetches issue data via the search API using the issue key attribute.
 * @param root0
 * @param root0.node
 */
export default function IssueEmbedNode({ node }: NodeViewProps) {
  const issueKey = (node.attrs.issueKey as string) || '';
  const [issue, setIssue] = useState<IssueData | null>(null);
  const [loading, setLoading] = useState(!!issueKey);
  const [error, setError] = useState(!issueKey);

  useEffect(() => {
    if (!issueKey) return;

    let cancelled = false;

    get<SearchResult[]>(`/search?q=${encodeURIComponent(issueKey)}&type=issues`)
      .then((results) => {
        if (cancelled) return;
        const issueGroup = results.find((r) => r.type === 'issues');
        const match: SearchResultItem | undefined = issueGroup?.items.find(
          (item) => item.key?.toUpperCase() === issueKey.toUpperCase(),
        );
        if (match) {
          setIssue({
            key: match.key || issueKey,
            title: match.title || 'Untitled',
            status: match.status || '',
            priority: match.priority || '',
            type: match.type || '',
            url: match.url,
            assignee: match.assignee,
          });
        } else {
          setError(true);
        }
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setError(true);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [issueKey]);

  if (loading) {
    return (
      <NodeViewWrapper>
        <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-secondary p-3 my-2">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Loading issue {issueKey}...</span>
        </div>
      </NodeViewWrapper>
    );
  }

  if (error || !issue) {
    return (
      <NodeViewWrapper>
        <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-secondary p-3 my-2">
          <CircleDot className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">
            {issueKey ? `Issue not found: ${issueKey}` : 'No issue key specified'}
          </span>
        </div>
      </NodeViewWrapper>
    );
  }

  const TypeIcon = TYPE_ICONS[issue.type.toUpperCase()] ?? CircleDot;
  const priorityConf = PRIORITY_CONFIG[issue.priority.toUpperCase()];
  const PriorityIcon = priorityConf?.icon;

  return (
    <NodeViewWrapper>
      <Link
        to={issue.url}
        className={cn(
          'flex items-center gap-3 rounded-lg border border-border bg-surface-secondary p-3 my-2',
          'no-underline hover:bg-surface-tertiary transition-colors',
        )}
        title={`${issue.key}: ${issue.title}`}
      >
        <TypeIcon className="h-5 w-5 shrink-0 text-muted-foreground" />

        <div className="flex flex-1 items-center gap-2 min-w-0">
          <Badge variant="outline" size="sm">
            {issue.key}
          </Badge>
          <span className="truncate text-sm font-medium text-text">{issue.title}</span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {PriorityIcon && (
            <span title={issue.priority}>
              <PriorityIcon className={cn('h-4 w-4', priorityConf.className)} />
            </span>
          )}
          {issue.status && (
            <span
              className={cn(
                'rounded px-1.5 py-0.5 text-xs font-medium',
                statusBadgeClass(issue.status),
              )}
            >
              {issue.status}
            </span>
          )}
          {issue.assignee && (
            <Avatar name={issue.assignee.displayName} src={issue.assignee.avatarUrl} size="xs" />
          )}
        </div>
      </Link>
    </NodeViewWrapper>
  );
}
