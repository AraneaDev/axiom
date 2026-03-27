import type { LucideIcon } from 'lucide-react';
import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';

import { cn } from '@/lib/utils';

export interface SlashCommandItem {
  name: string;
  category: string;
  icon: LucideIcon;
  action: () => void;
}

interface SlashCommandMenuProps {
  items: SlashCommandItem[];
  command: (item: SlashCommandItem) => void;
}

export interface SlashCommandMenuRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

const SlashCommandMenu = forwardRef<SlashCommandMenuRef, SlashCommandMenuProps>(
  ({ items, command }, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0);

    useEffect(() => setSelectedIndex(0), [items]);

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }: { event: KeyboardEvent }) => {
        if (event.key === 'ArrowUp') {
          setSelectedIndex((i) => (i - 1 + items.length) % items.length);
          return true;
        }
        if (event.key === 'ArrowDown') {
          setSelectedIndex((i) => (i + 1) % items.length);
          return true;
        }
        if (event.key === 'Enter') {
          if (items[selectedIndex]) command(items[selectedIndex]);
          return true;
        }
        return false;
      },
    }));

    if (!items.length) {
      return (
        <div className="bg-surface-elevated border border-border rounded-lg shadow-lg overflow-hidden min-w-[200px] p-3">
          <span className="text-text-tertiary text-sm">No matching commands</span>
        </div>
      );
    }

    // Group items by category preserving order
    const grouped: { category: string; items: SlashCommandItem[] }[] = [];
    for (const item of items) {
      const last = grouped[grouped.length - 1];
      if (last && last.category === item.category) {
        last.items.push(item);
      } else {
        grouped.push({ category: item.category, items: [item] });
      }
    }

    // Build a flat index for selection tracking
    let flatIdx = 0;

    return (
      <div className="bg-surface-elevated border border-border rounded-lg shadow-lg overflow-hidden min-w-[200px] max-h-[320px] overflow-y-auto">
        {grouped.map((group) => (
          <div key={group.category}>
            <div className="px-3 pt-2 pb-1 text-xs font-semibold text-text-tertiary uppercase tracking-wider">
              {group.category}
            </div>
            {group.items.map((item) => {
              const Icon = item.icon;
              const idx = flatIdx++;
              const isSelected = idx === selectedIndex;
              return (
                <button
                  key={item.name}
                  type="button"
                  onClick={() => command(item)}
                  className={cn(
                    'flex items-center gap-2 w-full px-3 py-1.5 text-sm text-left cursor-pointer',
                    isSelected
                      ? 'bg-surface-secondary text-text'
                      : 'text-text-secondary hover:bg-surface-secondary hover:text-text',
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span>{item.name}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    );
  },
);

SlashCommandMenu.displayName = 'SlashCommandMenu';
export default SlashCommandMenu;
