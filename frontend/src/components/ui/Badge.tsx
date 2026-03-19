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
  sm: 'px-1.5 py-0.5 text-[10px]',
  md: 'px-2 py-0.5 text-xs',
};

/**
 *
 * @param root0
 * @param root0.children
 * @param root0.variant
 * @param root0.size
 * @param root0.className
 * @param ref
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
