import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 *
 */
export const Card = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ children, className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('rounded-lg border border-border bg-surface-elevated', className)}
      {...props}
    >
      {children}
    </div>
  ),
);
Card.displayName = 'Card';

interface CardHeaderProps {
  children: ReactNode;
  className?: string;
}

/**
 *
 * @param root0
 * @param root0.children
 * @param root0.className
 */
export function CardHeader({ children, className }: CardHeaderProps) {
  return <div className={cn('px-5 py-4 border-b border-border', className)}>{children}</div>;
}

interface CardContentProps {
  children: ReactNode;
  className?: string;
}

/**
 *
 * @param root0
 * @param root0.children
 * @param root0.className
 */
export function CardContent({ children, className }: CardContentProps) {
  return <div className={cn('p-5', className)}>{children}</div>;
}
