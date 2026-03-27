import { NodeViewContent, NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { ChevronRight } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 *
 * @param root0
 * @param root0.node
 * @param root0.updateAttributes
 */
export function CollapsibleBlock({ node, updateAttributes }: NodeViewProps) {
  const isOpen = node.attrs.open as boolean;
  const title = (node.attrs.title as string) || 'Click to expand';

  return (
    <NodeViewWrapper>
      <div className="my-3 rounded-md border border-border bg-surface">
        <button
          type="button"
          className="flex w-full items-center gap-2 px-3 py-2 text-sm font-medium text-text hover:bg-surface-secondary rounded-t-md"
          onClick={() => updateAttributes({ open: !isOpen })}
        >
          <ChevronRight
            className={cn('h-4 w-4 transition-transform flex-shrink-0', isOpen && 'rotate-90')}
          />
          <input
            type="text"
            value={title}
            onChange={(e) => updateAttributes({ title: e.target.value })}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 bg-transparent border-none outline-none text-sm font-medium text-text placeholder:text-text-tertiary"
            placeholder="Section title..."
          />
        </button>
        {isOpen && (
          <div className="border-t border-border px-3 py-2">
            <NodeViewContent className="collapsible-content" />
          </div>
        )}
      </div>
    </NodeViewWrapper>
  );
}
