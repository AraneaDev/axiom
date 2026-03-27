import { NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { List } from 'lucide-react';
import { useEffect, useState, useCallback, useMemo } from 'react';

import { cn } from '@/lib/utils';

interface TocEntry {
  level: number;
  text: string;
  id: string;
}

function headingSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function extractHeadings(editor: NodeViewProps['editor']): TocEntry[] {
  const headings: TocEntry[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'heading') {
      const text = node.textContent;
      if (text) {
        headings.push({
          level: node.attrs.level as number,
          text,
          id: headingSlug(text),
        });
      }
    }
  });
  return headings;
}

/**
 *
 * @param root0
 * @param root0.editor
 */
export function TableOfContentsBlock({ editor }: NodeViewProps) {
  // Compute initial TOC synchronously (no setState in effect)
  const initialEntries = useMemo(() => extractHeadings(editor), [editor]);
  const [entries, setEntries] = useState<TocEntry[]>(initialEntries);

  const buildToc = useCallback(() => {
    setEntries(extractHeadings(editor));
  }, [editor]);

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    const handler = () => {
      clearTimeout(timeout);
      timeout = setTimeout(buildToc, 300);
    };

    editor.on('update', handler);
    return () => {
      editor.off('update', handler);
      clearTimeout(timeout);
    };
  }, [editor, buildToc]);

  function scrollToHeading(id: string) {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  return (
    <NodeViewWrapper>
      <div
        className="my-3 rounded-md border border-border bg-surface-secondary p-4"
        contentEditable={false}
      >
        <div className="flex items-center gap-2 mb-2 text-sm font-medium text-text">
          <List className="h-4 w-4" />
          Table of Contents
        </div>
        {entries.length === 0 ? (
          <p className="text-sm text-text-tertiary">
            No headings found. Add headings to generate a table of contents.
          </p>
        ) : (
          <ul className="space-y-1">
            {entries.map((entry, i) => (
              <li
                key={`${entry.id}-${i}`}
                className={cn('text-sm', entry.level === 2 && 'ml-4', entry.level === 3 && 'ml-8')}
              >
                <button
                  type="button"
                  className="text-primary hover:underline text-left"
                  onClick={() => scrollToHeading(entry.id)}
                >
                  {entry.text}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </NodeViewWrapper>
  );
}
