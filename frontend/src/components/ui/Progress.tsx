import { cn } from '@/lib/utils';

interface ProgressProps {
  value: number;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'primary' | 'success' | 'warning' | 'danger';
  className?: string;
}

const heights = {
  sm: 'h-1',
  md: 'h-2',
  lg: 'h-3',
};

const variants = {
  primary: 'bg-primary',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
};

/**
 *
 * @param root0
 * @param root0.value
 * @param root0.size
 * @param root0.variant
 * @param root0.className
 */
export function Progress({ value, size = 'md', variant = 'primary', className }: ProgressProps) {
  const clamped = Math.max(0, Math.min(100, value));

  return (
    <div
      className={cn(
        'w-full rounded-full bg-surface-tertiary overflow-hidden',
        heights[size],
        className,
      )}
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={cn(
          'h-full rounded-full transition-all duration-300 ease-out',
          variants[variant],
        )}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
