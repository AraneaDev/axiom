import { Code2, FileText, GitFork, Eye, Lock } from 'lucide-react';
import { Link } from 'react-router';

import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { IssueTypeIcon } from '@/components/ui/IssueTypeIcon';
import type { SearchResultItem } from '@/lib/types';

// --- Row Component Types ---

export interface CodeItem extends SearchResultItem {
  repoId: string;
  repoName: string;
  repoUrl: string;
  filePath: string;
  lineNumber: number;
  lineContent: string;
}

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
 * @param root0
 * @param root0.item
 * @param root0.query
 */
export function CodeRow({ item, query }: { item: CodeItem; query: string }) {
  const highlighted = highlightMatch(item.lineContent, query);

  return (
    <div className="p-3 hover:bg-surface-secondary transition-colors">
      <div className="flex items-center gap-2 mb-1.5">
        <Code2 className="h-3.5 w-3.5 text-text-tertiary" />
        <Link to={item.repoUrl} className="text-xs font-medium text-primary hover:underline">
          {item.repoName}
        </Link>
        <span className="text-text-tertiary text-xs">/</span>
        <Link
          to={`${item.repoUrl}/blob/HEAD/${item.filePath}`}
          className="text-xs text-text-secondary hover:text-primary hover:underline truncate"
        >
          {item.filePath}
        </Link>
      </div>
      <div className="rounded bg-surface-tertiary border border-border-light px-3 py-1.5 font-mono text-xs overflow-x-auto">
        <span className="text-text-tertiary select-none mr-3">{item.lineNumber}</span>
        {/* eslint-disable-next-line react/no-danger -- search highlight markup is escaped server-side */}
        <span dangerouslySetInnerHTML={{ __html: highlighted }} />
      </div>
    </div>
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

/**
 *
 * @param root0
 * @param root0.item
 */
export function RepoRow({ item }: { item: SearchResultItem }) {
  const isPublic = item.visibility === 'PUBLIC';

  return (
    <Link
      to={item.url ?? '#'}
      className="flex items-center gap-3 p-3 hover:bg-surface-secondary transition-colors"
    >
      <GitFork className="h-4 w-4 text-text-secondary" />
      <span className="text-sm font-medium">{item.name}</span>
      <span className="text-xs text-text-tertiary flex-1 truncate">
        {item.description || 'No description'}
      </span>
      <Badge size="sm" variant={isPublic ? 'success' : 'outline'}>
        {isPublic ? <Eye className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
        {item.visibility?.toLowerCase()}
      </Badge>
    </Link>
  );
}

// --- Helpers ---

function highlightMatch(text: string, query: string): string {
  if (!query) return escapeHtml(text);
  // Extract just the free text part (remove structured filters)
  const freeText = query
    .split(/\s+/)
    .filter((t) => !t.includes(':'))
    .join(' ')
    .trim();
  if (!freeText) return escapeHtml(text);

  const escaped = freeText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escaped})`, 'gi');
  return escapeHtml(text).replace(
    regex,
    '<mark class="bg-warning-light text-warning rounded px-0.5">$1</mark>',
  );
}

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
