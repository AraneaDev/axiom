import { forwardRef, type HTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

interface ProgressProps extends HTMLAttributes<HTMLDivElement> {
  value: number;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'primary' | 'success' | 'warning' | 'danger';
}

const heights = {
  sm: 'h-1',
  md: 'h-2',
  lg: 'h-3',
};

const variants = {
  primary: 'bg-gradient-to-r from-primary to-primary-hover',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
};

/**
 * Horizontal progress bar with configurable size and color variant.
 * Renders an accessible progressbar role with aria attributes.
 * The value is clamped between 0 and 100.
 * @param props - Progress bar configuration.
 * @param props.value - Completion percentage (0-100).
 * @param props.size - Bar height: sm, md, lg. Defaults to md.
 * @param props.variant - Color scheme: primary, success, warning, danger. Defaults to primary.
 */
export const Progress = forwardRef<HTMLDivElement, ProgressProps>(
  ({ value, size = 'md', variant = 'primary', className, ...props }, ref) => {
    const clamped = Math.max(0, Math.min(100, value));

    return (
      <div
        ref={ref}
        className={cn(
          'w-full rounded-full bg-surface-tertiary overflow-hidden',
          heights[size],
          className,
        )}
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        {...props}
      >
        <div
          className={cn(
            'h-full rounded-full transition-all duration-500 ease-out',
            variants[variant],
          )}
          style={{ width: `${clamped}%` }}
        />
      </div>
    );
  },
);
Progress.displayName = 'Progress';
