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
  top: 'top-full left-1/2 -translate-x-1/2 border-t-[#1e293b] border-x-transparent border-b-transparent border-4',
  bottom:
    'bottom-full left-1/2 -translate-x-1/2 border-b-[#1e293b] border-x-transparent border-t-transparent border-4',
  left: 'left-full top-1/2 -translate-y-1/2 border-l-[#1e293b] border-y-transparent border-r-transparent border-4',
  right:
    'right-full top-1/2 -translate-y-1/2 border-r-[#1e293b] border-y-transparent border-l-transparent border-4',
};

/**
 *
 * @param root0
 * @param root0.content
 * @param root0.side
 * @param root0.children
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
        <span className="whitespace-nowrap max-w-xs rounded-md bg-[#1e293b] px-2.5 py-1.5 text-xs text-white shadow-lg">
          {content}
        </span>
        <span className={cn('absolute', arrows[side])} />
      </span>
    </span>
  );
}
