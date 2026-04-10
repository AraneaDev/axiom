import { type ReactNode } from 'react';

import { cn } from '@/lib/utils';

interface TooltipProps {
  content: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
  children: ReactNode;
}

const positions = {
  top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
  bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
  left: 'right-full top-1/2 -translate-y-1/2 mr-2',
  right: 'left-full top-1/2 -translate-y-1/2 ml-2',
};

const arrows = {
  top: 'top-full left-1/2 -translate-x-1/2 border-t-surface-inverse border-x-transparent border-b-transparent border-4',
  bottom:
    'bottom-full left-1/2 -translate-x-1/2 border-b-surface-inverse border-x-transparent border-t-transparent border-4',
  left: 'left-full top-1/2 -translate-y-1/2 border-l-surface-inverse border-y-transparent border-r-transparent border-4',
  right:
    'right-full top-1/2 -translate-y-1/2 border-r-surface-inverse border-y-transparent border-l-transparent border-4',
};

/**
 * Hover-triggered tooltip that displays a text hint near the wrapped element.
 * Uses CSS group-hover for zero-JS show/hide behavior.
 * @param props - Tooltip configuration.
 * @param props.content - Text to display inside the tooltip.
 * @param props.side - Tooltip placement relative to the trigger: top, bottom, left, right. Defaults to top.
 * @param props.children - The element that triggers the tooltip on hover.
 */
export function Tooltip({ content, side = 'top', children }: TooltipProps) {
  return (
    <span className="group relative inline-flex">
      {children}
      <span
        className={cn(
          'pointer-events-none absolute z-50 hidden group-hover:flex items-center animate-fade-in',
          positions[side],
        )}
      >
        <span className="whitespace-nowrap max-w-xs rounded-md bg-surface-inverse px-2.5 py-1.5 text-xs text-text-inverse shadow-lg">
          {content}
        </span>
        <span className={cn('absolute', arrows[side])} />
      </span>
    </span>
  );
}
