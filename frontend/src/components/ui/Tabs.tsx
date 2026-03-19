import { type ReactNode } from 'react';

import { cn } from '@/lib/utils';

interface Tab {
  key: string;
  label: string;
  icon?: ReactNode;
}

interface TabsProps {
  tabs: Tab[];
  activeKey: string;
  onChange: (key: string) => void;
  className?: string;
}

/**
 * Horizontal tab bar navigation with active indicator.
 * Each tab can include an optional icon alongside its label.
 * @param props - Tabs configuration.
 * @param props.tabs - Array of tab definitions with key, label, and optional icon.
 * @param props.activeKey - The key of the currently active tab.
 * @param props.onChange - Callback fired with the new tab key when a tab is clicked.
 * @param props.className - Additional CSS classes for the tab container.
 */
export function Tabs({ tabs, activeKey, onChange, className }: TabsProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-1 overflow-x-auto border-b border-border scrollbar-none',
        className,
      )}
    >
      {tabs.map((tab) => {
        const active = tab.key === activeKey;
        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => onChange(tab.key)}
            className={cn(
              'relative flex items-center gap-1.5 px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors',
              active ? 'text-primary' : 'text-text-tertiary hover:text-text',
            )}
          >
            {tab.icon && <span className="h-4 w-4">{tab.icon}</span>}
            {tab.label}
            {active && (
              <span className="absolute inset-x-0 -bottom-px h-0.5 bg-primary rounded-full" />
            )}
          </button>
        );
      })}
    </div>
  );
}
