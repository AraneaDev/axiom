/* eslint-disable react-refresh/only-export-components */
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Hash,
  MoreHorizontal,
  Plus,
} from 'lucide-react';
import { useState, useMemo, useCallback } from 'react';
import { Link } from 'react-router';

import { Button } from '@/components/ui/Button';
import { Dropdown, DropdownItem } from '@/components/ui/Dropdown';
import type { PageTreeNode } from '@/lib/types';
import { cn } from '@/lib/utils';

interface TocEntry {
  level: number;
  text: string;
  id: string;
}

/**
 *
 * @param markdown
 */
export function extractToc(markdown: string): TocEntry[] {
  const headingRegex = /^(#{1,3})\s+(.+)$/gm;
  const entries: TocEntry[] = [];
  let match;
  while ((match = headingRegex.exec(markdown)) !== null) {
    const text = match[2].trim();
    const id = text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    entries.push({ level: match[1].length, text, id });
  }
  return entries;
}

function TableOfContents({ entries }: { entries: TocEntry[] }) {
  if (!entries.length) return null;

  function scrollTo(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <nav className="space-y-1">
      <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-2">
        On this page
      </h3>
      {entries.map((entry, i) => (
        <Button
          key={`${entry.id}-${i}`}
          variant="ghost"
          size="xs"
          type="button"
          onClick={() => scrollTo(entry.id)}
          className={cn(
            'w-full justify-start text-text-tertiary hover:text-primary truncate',
            entry.level === 1 && 'font-medium text-text-secondary',
            entry.level === 2 && 'pl-3',
            entry.level === 3 && 'pl-6 text-xs',
          )}
        >
          <Hash className="h-3 w-3" /> {entry.text}
        </Button>
      ))}
    </nav>
  );
}

/**
 * Collect all ancestor node IDs for a given slug so we can auto-expand the path.
 * @param nodes
 * @param targetSlug
 * @param ancestors
 */
function collectAncestorIds(
  nodes: PageTreeNode[],
  targetSlug: string,
  ancestors: string[] = [],
): string[] | null {
  for (const node of nodes) {
    if (node.slug === targetSlug) {
      return ancestors;
    }
    if (node.children.length > 0) {
      const found = collectAncestorIds(node.children, targetSlug, [...ancestors, node.id]);
      if (found) return found;
    }
  }
  return null;
}

function TreeNode({
  node,
  basePath,
  depth = 0,
  activeSlug,
  expanded,
  onToggle,
  onNewFolder,
}: {
  node: PageTreeNode;
  basePath: string;
  depth?: number;
  activeSlug?: string;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onNewFolder?: (parentId?: string) => void;
}) {
  const hasChildren = node.children.length > 0;
  const isExpanded = expanded.has(node.id);
  const isActive = node.slug === activeSlug;

  return (
    <div>
      <div
        className={cn(
          'group flex items-center gap-1 py-1 px-1 rounded-md text-sm hover:bg-surface-tertiary transition-colors',
          isActive && 'bg-primary-light text-primary font-medium',
        )}
        style={{ paddingLeft: `${depth * 16 + 4}px` }}
      >
        {/* Collapse toggle */}
        {hasChildren ? (
          <button
            type="button"
            onClick={() => onToggle(node.id)}
            className="shrink-0 p-0.5 rounded hover:bg-surface-secondary transition-colors text-text-tertiary"
            title={isExpanded ? 'Collapse' : 'Expand'}
          >
            {isExpanded ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
          </button>
        ) : (
          <span className="shrink-0 w-[18px]" />
        )}

        {/* Icon */}
        {hasChildren ? (
          isExpanded ? (
            <FolderOpen className="h-3.5 w-3.5 text-text-secondary shrink-0" />
          ) : (
            <Folder className="h-3.5 w-3.5 text-text-secondary shrink-0" />
          )
        ) : (
          <FileText className="h-3.5 w-3.5 text-text-secondary shrink-0" />
        )}

        {/* Link */}
        <Link to={`${basePath}/${node.slug}`} className="truncate flex-1 py-0.5">
          {node.title}
        </Link>

        {/* Context menu */}
        <div className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          <Dropdown
            trigger={
              <button
                type="button"
                className="p-0.5 rounded hover:bg-surface-secondary text-text-tertiary"
                title="Actions"
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </button>
            }
            align="right"
          >
            <DropdownItem
              onClick={() => {
                window.location.href = `${basePath}/new/edit?parent=${node.id}`;
              }}
            >
              <Plus className="h-3.5 w-3.5" /> New Child Page
            </DropdownItem>
            <DropdownItem onClick={() => onNewFolder?.(node.id)}>
              <FolderPlus className="h-3.5 w-3.5" /> New Folder
            </DropdownItem>
          </Dropdown>
        </div>
      </div>

      {/* Children (collapsible) */}
      {hasChildren &&
        isExpanded &&
        node.children.map((child) => (
          <TreeNode
            key={child.id}
            node={child}
            basePath={basePath}
            depth={depth + 1}
            activeSlug={activeSlug}
            expanded={expanded}
            onToggle={onToggle}
            onNewFolder={onNewFolder}
          />
        ))}
    </div>
  );
}

interface PageViewSidebarProps {
  tree: PageTreeNode[] | undefined;
  basePath: string;
  tocEntries: TocEntry[];
  activeSlug?: string;
  onNewFolder?: (parentId?: string) => void;
  /** When true, hides the built-in header (New Page / New Folder buttons) */
  embedded?: boolean;
  className?: string;
}

/**
 * Sidebar showing page tree and table of contents.
 * @param root0
 * @param root0.tree
 * @param root0.basePath
 * @param root0.tocEntries
 * @param root0.activeSlug
 * @param root0.onNewFolder
 * @param root0.embedded
 * @param root0.className
 */
export function PageViewSidebar({
  tree,
  basePath,
  tocEntries,
  activeSlug,
  onNewFolder,
  embedded,
  className,
}: PageViewSidebarProps) {
  const defaultExpanded = useMemo(() => {
    if (!tree || !activeSlug) return new Set<string>();
    const ids = collectAncestorIds(tree, activeSlug);
    return new Set<string>(ids ?? []);
  }, [tree, activeSlug]);

  const [expanded, setExpanded] = useState<Set<string>>(defaultExpanded);

  const handleToggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  return (
    <div className={cn('', className)}>
      {!embedded && (
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wide">
            Pages
          </h3>
          <div className="flex gap-1">
            <Link to={`${basePath}/new/edit`}>
              <Button variant="ghost" size="xs" title="New Page">
                <Plus className="h-3.5 w-3.5" /> New Page
              </Button>
            </Link>
            <Button variant="ghost" size="xs" title="New Folder" onClick={() => onNewFolder?.()}>
              <FolderPlus className="h-3.5 w-3.5" /> New Folder
            </Button>
          </div>
        </div>
      )}
      <div className="space-y-0.5 mb-6">
        {tree?.map((node) => (
          <TreeNode
            key={node.id}
            node={node}
            basePath={basePath}
            activeSlug={activeSlug}
            expanded={expanded}
            onToggle={handleToggle}
            onNewFolder={onNewFolder}
          />
        ))}
      </div>

      {/* Table of contents */}
      {tocEntries.length > 0 && (
        <div className="border-t border-border-light pt-4">
          <TableOfContents entries={tocEntries} />
        </div>
      )}
    </div>
  );
}
