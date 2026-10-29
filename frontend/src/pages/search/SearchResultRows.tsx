import { FileText } from 'lucide-react';
import { Link } from 'react-router';

import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { IssueTypeIcon } from '@/components/ui/IssueTypeIcon';
import type { SearchResultItem } from '@/lib/types';

// --- Row Components ---

/**
 *
 * @param root0
 * @param root0.item
 */
export function IssueRow({ item }: { item: SearchResultItem }) {
  return (
    <Link
      to={item.url ?? '#'}
      className="flex items-center gap-3 p-3 hover:bg-surface-secondary transition-colors"
    >
      <IssueTypeIcon type={item.type ?? ''} className="h-3.5 w-3.5" />
      <span className="text-xs font-mono text-text-secondary">{item.key}</span>
      <span className="text-sm font-medium flex-1 truncate">{item.title}</span>
      <Badge size="sm">{item.status}</Badge>
      <span className="text-xs text-text-tertiary">{item.projectName}</span>
      {item.assignee && (
        <Avatar name={item.assignee.displayName} src={item.assignee.avatarUrl} size="xs" />
      )}
      <Badge
        size="sm"
        variant={
          item.priority === 'CRITICAL'
            ? 'danger'
            : item.priority === 'HIGH'
              ? 'warning'
              : item.priority === 'LOW'
                ? 'success'
                : 'default'
        }
      >
        {item.priority}
      </Badge>
    </Link>
  );
}

/**
 *
 * @param root0
 * @param root0.item
 */
export function WikiRow({ item }: { item: SearchResultItem }) {
  return (
    <Link to={item.url ?? '#'} className="block p-3 hover:bg-surface-secondary transition-colors">
      <div className="flex items-center gap-3 mb-1">
        <FileText className="h-4 w-4 text-text-secondary" />
        <span className="text-sm font-medium flex-1">{item.title}</span>
        <Badge size="sm">{item.spaceName || item.slug}</Badge>
      </div>
      {item.snippet && (
        <p
          className="text-xs text-text-tertiary ml-7 line-clamp-2"
          // eslint-disable-next-line react/no-danger -- snippet is escaped server-side
          dangerouslySetInnerHTML={{ __html: formatSnippet(item.snippet) }}
        />
      )}
    </Link>
  );
}

// --- Helpers ---

function formatSnippet(snippet: string): string {
  // Convert << >> markers from ts_headline to <mark> tags
  return escapeHtml(snippet)
    .replace(/&lt;&lt;/g, '<mark class="bg-warning-light text-warning rounded px-0.5">')
    .replace(/&gt;&gt;/g, '</mark>');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
