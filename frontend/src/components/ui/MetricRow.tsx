import { type LucideIcon } from 'lucide-react';
import { forwardRef, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

interface MetricRowProps {
  label: string;
  value: ReactNode;
  icon?: LucideIcon;
  className?: string;
}

export const MetricRow = forwardRef<HTMLDivElement, MetricRowProps>(
  ({ label, value, icon: Icon, className }, ref) => {
    return (
      <div ref={ref} className={cn('flex items-center justify-between py-1.5', className)}>
        <span className="flex items-center gap-2 text-sm text-text-secondary">
          {Icon && <Icon className="h-3.5 w-3.5" />}
          {label}
        </span>
        <span className="text-sm font-medium">{value}</span>
      </div>
    );
  },
);

MetricRow.displayName = 'MetricRow';
