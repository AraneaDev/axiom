import { type ReactNode } from 'react';

import { cn } from '@/lib/utils';

interface CardProps {
  children: ReactNode;
  className?: string;
}

/**
 *
 * @param root0
 * @param root0.children
 * @param root0.className
 */
export function Card({ children, className }: CardProps) {
  return (
    <div className={cn('rounded-lg border border-border bg-surface', className)}>{children}</div>
  );
}

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
