import { type NodeViewProps, NodeViewWrapper } from '@tiptap/react';
import { Bug, BookOpen, CheckSquare, Layers, FileText, CircleDot } from 'lucide-react';
import type { ComponentType, SVGProps } from 'react';
import { Link } from 'react-router';

import { statusColorClass } from '@/lib/status-colors';
import { cn } from '@/lib/utils';

/** Map icon name strings to Lucide icon components. */
const ICON_MAP: Record<
  string,
  ComponentType<SVGProps<SVGSVGElement> & { size?: number | string }>
> = {
  bug: Bug,
  story: BookOpen,
  task: CheckSquare,
  epic: Layers,
  'file-text': FileText,
};

/**
 * Inline React node view for a resolved smart link preview.
 * Shows: icon + key (mono) + title (truncated) + status badge.
 * @param root0
 * @param root0.node
 */
export default function SmartLinkNode({ node }: NodeViewProps) {
  const { url, title, key, status, icon } = node.attrs;
  const IconComponent = ICON_MAP[icon] ?? CircleDot;

  return (
    <NodeViewWrapper as="span" className="inline">
      <Link
        to={url}
        className={cn(
          'inline-flex items-center gap-1 rounded px-1.5 py-0.5',
          'border border-border bg-surface-secondary',
          'text-sm no-underline hover:bg-surface-tertiary transition-colors',
          'align-baseline',
        )}
        title={`${key}: ${title}`}
      >
        <IconComponent className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="font-mono text-xs font-medium text-text">{key}</span>
        <span className="max-w-[200px] truncate text-xs text-text-secondary">{title}</span>
        {status && (
          <span
            className={cn(
              'rounded px-1 py-px text-[10px] font-medium leading-tight',
              statusColorClass(status),
            )}
          >
            {status}
          </span>
        )}
      </Link>
    </NodeViewWrapper>
  );
}
