import { NodeViewContent, NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { Info, AlertTriangle, StickyNote, CheckCircle, XCircle, ChevronDown } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';

import type { CalloutType } from './CalloutExtension';

import { cn } from '@/lib/utils';

const calloutConfig: Record<
  CalloutType,
  { icon: typeof Info; borderColor: string; bgColor: string; iconColor: string; label: string }
> = {
  info: {
    icon: Info,
    borderColor: 'border-l-[var(--color-info)]',
    bgColor: 'bg-[var(--color-info)]/10',
    iconColor: 'text-[var(--color-info)]',
    label: 'Info',
  },
  warning: {
    icon: AlertTriangle,
    borderColor: 'border-l-[var(--color-warning)]',
    bgColor: 'bg-[var(--color-warning)]/10',
    iconColor: 'text-[var(--color-warning)]',
    label: 'Warning',
  },
  note: {
    icon: StickyNote,
    borderColor: 'border-l-[var(--color-primary)]',
    bgColor: 'bg-[var(--color-primary)]/10',
    iconColor: 'text-[var(--color-primary)]',
    label: 'Note',
  },
  success: {
    icon: CheckCircle,
    borderColor: 'border-l-[var(--color-success)]',
    bgColor: 'bg-[var(--color-success)]/10',
    iconColor: 'text-[var(--color-success)]',
    label: 'Success',
  },
  error: {
    icon: XCircle,
    borderColor: 'border-l-[var(--color-danger)]',
    bgColor: 'bg-[var(--color-danger)]/10',
    iconColor: 'text-[var(--color-danger)]',
    label: 'Error',
  },
};

const calloutTypes: CalloutType[] = ['info', 'warning', 'note', 'success', 'error'];

/**
 *
 * @param root0
 * @param root0.node
 * @param root0.updateAttributes
 */
export function CalloutBlock({ node, updateAttributes }: NodeViewProps) {
  const type = (node.attrs.type as CalloutType) || 'info';
  const config = calloutConfig[type];
  const Icon = config.icon;
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as HTMLElement)) {
        setShowDropdown(false);
      }
    }
    if (showDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showDropdown]);

  return (
    <NodeViewWrapper>
      <div
        className={cn(
          'my-3 rounded-r-md border-l-4 p-3 flex gap-3',
          config.borderColor,
          config.bgColor,
        )}
      >
        <div className="relative flex-shrink-0 pt-0.5" ref={dropdownRef}>
          <button
            type="button"
            className={cn(
              'flex items-center gap-0.5 rounded p-0.5 hover:bg-black/10',
              config.iconColor,
            )}
            onClick={() => setShowDropdown(!showDropdown)}
            title="Change callout type"
          >
            <Icon className="h-5 w-5" />
            <ChevronDown className="h-3 w-3" />
          </button>
          {showDropdown && (
            <div className="absolute left-0 top-full z-50 mt-1 w-36 rounded-md border border-border bg-surface shadow-lg py-1">
              {calloutTypes.map((t) => {
                const c = calloutConfig[t];
                const TypeIcon = c.icon;
                return (
                  <button
                    key={t}
                    type="button"
                    className={cn(
                      'flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-surface-secondary',
                      t === type && 'bg-surface-secondary font-medium',
                    )}
                    onClick={() => {
                      updateAttributes({ type: t });
                      setShowDropdown(false);
                    }}
                  >
                    <TypeIcon className={cn('h-4 w-4', calloutConfig[t].iconColor)} />
                    {c.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <NodeViewContent as="div" className="flex-1 min-w-0 callout-content [&>p]:my-0" />
      </div>
    </NodeViewWrapper>
  );
}
