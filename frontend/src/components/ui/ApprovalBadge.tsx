import { CheckCircle, Clock, XCircle } from 'lucide-react';
import { forwardRef, type HTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

interface ApprovalBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  status: ApprovalStatus;
  targetColumnName?: string;
}

const statusConfig: Record<
  ApprovalStatus,
  { icon: React.ElementType; label: string; className: string }
> = {
  PENDING: {
    icon: Clock,
    label: 'Awaiting',
    className: 'bg-warning-light text-warning',
  },
  APPROVED: {
    icon: CheckCircle,
    label: 'Approved',
    className: 'bg-success-light text-success',
  },
  REJECTED: {
    icon: XCircle,
    label: 'Rejected',
    className: 'bg-danger-light text-danger',
  },
  CANCELLED: {
    icon: XCircle,
    label: 'Cancelled',
    className: 'bg-surface-tertiary text-text-secondary',
  },
};

/**
 * Inline badge displaying an approval request status with icon.
 * @param props - Badge props.
 * @param props.status - Approval status: PENDING, APPROVED, REJECTED, CANCELLED.
 * @param props.targetColumnName - Optional target column name shown in tooltip.
 */
export const ApprovalBadge = forwardRef<HTMLSpanElement, ApprovalBadgeProps>(
  ({ status, targetColumnName, className, ...props }, ref) => {
    const config = statusConfig[status];
    const Icon = config.icon;
    const tooltip = targetColumnName
      ? `${config.label} — moving to ${targetColumnName}`
      : config.label;

    return (
      <span
        ref={ref}
        title={tooltip}
        className={cn(
          'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-xs font-medium leading-none transition-colors duration-150',
          config.className,
          className,
        )}
        {...props}
      >
        <Icon className="h-3 w-3" />
        {config.label}
      </span>
    );
  },
);
ApprovalBadge.displayName = 'ApprovalBadge';
