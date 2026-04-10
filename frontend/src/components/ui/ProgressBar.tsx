import { forwardRef } from 'react';

import { cn } from '@/lib/utils';

interface ProgressBarProps {
  /** Value between 0 and 100 */
  value: number;
  className?: string;
  /** CSS variable string, e.g. 'var(--color-success)' */
  color?: string;
}

/**
 * Slim horizontal progress bar using CSS variable color tokens.
 * @param props.value - Percentage complete (0-100).
 * @param props.className - Additional classes for the outer track.
 * @param props.color - Fill color as a CSS variable. Defaults to var(--color-primary).
 */
export const ProgressBar = forwardRef<HTMLDivElement, ProgressBarProps>(
  ({ value, className, color = 'var(--color-primary)' }, ref) => {
    const clamped = Math.min(100, Math.max(0, value));
    return (
      <div
        ref={ref}
        className={cn('h-1.5 w-full rounded-full bg-surface-secondary overflow-hidden', className)}
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{ width: `${clamped}%`, backgroundColor: color }}
        />
      </div>
    );
  },
);
ProgressBar.displayName = 'ProgressBar';
