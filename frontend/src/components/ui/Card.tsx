import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'elevated' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  hover?: boolean;
  header?: ReactNode;
  footer?: ReactNode;
}

const variants = {
  default: 'border border-border bg-surface',
  elevated: 'bg-surface shadow-md',
  ghost: 'bg-surface-secondary',
};

const sizes = {
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-6',
};

export const Card = forwardRef<HTMLDivElement, CardProps>(
  (
    { className, variant = 'default', size = 'md', hover, header, footer, children, ...props },
    ref,
  ) => (
    <div
      ref={ref}
      className={cn(
        'rounded-lg',
        variants[variant],
        sizes[size],
        hover && 'hover-lift hover:border-border-focus/30 cursor-pointer',
        className,
      )}
      {...props}
    >
      {header && (
        <div className="mb-3 pb-3 border-b border-border-light font-medium text-sm text-text">
          {header}
        </div>
      )}
      {children}
      {footer && (
        <div className="mt-3 pt-3 border-t border-border-light text-sm text-text-secondary">
          {footer}
        </div>
      )}
    </div>
  ),
);
Card.displayName = 'Card';
