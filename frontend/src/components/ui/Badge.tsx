import { forwardRef, type HTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'primary' | 'danger' | 'warning' | 'success' | 'outline';
  size?: 'sm' | 'md';
}

const variants = {
  default: 'bg-surface-tertiary text-text-secondary',
  primary: 'bg-primary-light text-primary',
  danger: 'bg-danger-light text-danger',
  warning: 'bg-warning-light text-warning',
  success: 'bg-success-light text-success',
  outline: 'border border-border text-text-secondary',
};

const sizes = {
  sm: 'px-1.5 py-0.5 text-xs',
  md: 'px-2 py-0.5 text-xs',
};

/**
 * Inline status or label chip with color variants.
 * Renders as a rounded pill with icon and text support.
 * @param props - Badge props extending native span attributes.
 * @param props.variant - Color scheme: default, primary, danger, warning, success, outline. Defaults to default.
 * @param props.size - Badge size: sm, md. Defaults to md.
 */
export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ children, variant = 'default', size = 'md', className, ...props }, ref) => {
    return (
      <span
        ref={ref}
        className={cn(
          'inline-flex items-center gap-1 rounded-full font-medium leading-none transition-colors duration-150',
          variants[variant],
          sizes[size],
          className,
        )}
        {...props}
      >
        {children}
      </span>
    );
  },
);
Badge.displayName = 'Badge';
