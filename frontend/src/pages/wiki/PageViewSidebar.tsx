import { FileText, Hash } from 'lucide-react';
import { Link } from 'react-router';

import { Button } from '@/components/ui/Button';
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

function TreeNode({
  node,
  basePath,
  depth = 0,
}: {
  node: PageTreeNode;
  basePath: string;
  depth?: number;
}) {
  return (
    <div>
      <Link
        to={`${basePath}/${node.slug}`}
        className="flex items-center gap-2 py-1.5 px-2 rounded-md text-sm hover:bg-surface-tertiary transition-colors"
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        <FileText className="h-3.5 w-3.5 text-text-secondary shrink-0" />
        <span className="truncate">{node.title}</span>
      </Link>
      {node.children?.map((child) => (
        <TreeNode key={child.id} node={child} basePath={basePath} depth={depth + 1} />
      ))}
    </div>
  );
}

interface PageViewSidebarProps {
  tree: PageTreeNode[] | undefined;
  basePath: string;
  tocEntries: TocEntry[];
}

/**
 *
 * @param root0
 * @param root0.tree
 * @param root0.basePath
 * @param root0.tocEntries
 */
export function PageViewSidebar({ tree, basePath, tocEntries }: PageViewSidebarProps) {
  return (
    <div className="col-span-1 hidden lg:block">
      <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-2">
        Pages
      </h3>
      <div className="space-y-0.5 mb-6">
        {tree?.map((node) => (
          <TreeNode key={node.id} node={node} basePath={basePath} />
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
