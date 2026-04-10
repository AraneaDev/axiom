import { type LucideIcon } from 'lucide-react';
import { forwardRef } from 'react';

import { cn } from '@/lib/utils';

const variantStyles = {
  default: {
    icon: 'text-text-secondary bg-surface-tertiary',
  },
  primary: {
    icon: 'text-primary bg-primary-light',
  },
  success: {
    icon: 'text-success bg-success-light',
  },
  warning: {
    icon: 'text-warning bg-warning-light',
  },
  danger: {
    icon: 'text-danger bg-danger-light',
  },
};

interface StatCardProps {
  label: string;
  value: string | number;
  change?: number;
  changeLabel?: string;
  icon: LucideIcon;
  variant?: keyof typeof variantStyles;
  className?: string;
}

export const StatCard = forwardRef<HTMLDivElement, StatCardProps>(
  ({ label, value, change, changeLabel, icon: Icon, variant = 'default', className }, ref) => {
    const styles = variantStyles[variant];

    return (
      <div
        ref={ref}
        className={cn('rounded-lg border border-border bg-surface-elevated p-5', className)}
      >
        <div className="flex items-center gap-4">
          <div className={cn('rounded-lg p-2.5', styles.icon)}>
            <Icon className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-text-tertiary">{label}</p>
            <p className="text-2xl font-semibold tabular-nums leading-tight mt-0.5">{value}</p>
          </div>
        </div>
        {change !== undefined && (
          <div className="mt-3 flex items-center gap-1.5 text-xs">
            <span
              className={cn(
                'font-medium',
                change > 0 && 'text-success',
                change < 0 && 'text-danger',
                change === 0 && 'text-text-tertiary',
              )}
            >
              {change > 0 ? '+' : ''}
              {change}%
            </span>
            {changeLabel && <span className="text-text-tertiary">{changeLabel}</span>}
          </div>
        )}
      </div>
    );
  },
);

StatCard.displayName = 'StatCard';
