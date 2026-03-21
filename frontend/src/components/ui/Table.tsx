import {
  forwardRef,
  type HTMLAttributes,
  type TdHTMLAttributes,
  type ThHTMLAttributes,
} from 'react';

import { cn } from '@/lib/utils';

/**
 * Shared table primitives for consistent data table styling.
 * For code-display tables (diffs, blame, file view), use raw elements instead.
 */

export const Table = forwardRef<HTMLTableElement, HTMLAttributes<HTMLTableElement>>(
  ({ className, ...props }, ref) => (
    <table ref={ref} className={cn('w-full text-sm', className)} {...props} />
  ),
);
Table.displayName = 'Table';

export const Thead = forwardRef<HTMLTableSectionElement, HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => <thead ref={ref} className={cn('', className)} {...props} />,
);
Thead.displayName = 'Thead';

export const Tbody = forwardRef<HTMLTableSectionElement, HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <tbody ref={ref} className={cn('divide-y divide-border-light', className)} {...props} />
  ),
);
Tbody.displayName = 'Tbody';

export const Tr = forwardRef<HTMLTableRowElement, HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => (
    <tr
      ref={ref}
      className={cn('hover:bg-surface-secondary transition-colors', className)}
      {...props}
    />
  ),
);
Tr.displayName = 'Tr';

/** Header row -- no hover, bottom border, secondary background. */
export const TrHead = forwardRef<HTMLTableRowElement, HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => (
    <tr
      ref={ref}
      className={cn('border-b border-border bg-surface-secondary h-11', className)}
      {...props}
    />
  ),
);
TrHead.displayName = 'TrHead';

export const Th = forwardRef<HTMLTableCellElement, ThHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => (
    <th
      ref={ref}
      className={cn(
        'px-4 py-3.5 text-left text-xs font-medium text-text-tertiary uppercase tracking-wide',
        className,
      )}
      {...props}
    />
  ),
);
Th.displayName = 'Th';

export const Td = forwardRef<HTMLTableCellElement, TdHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => (
    <td ref={ref} className={cn('px-4 py-3', className)} {...props} />
  ),
);
Td.displayName = 'Td';

/** Standard wrapper for data tables: rounded border, surface bg, overflow hidden. */
export const TableContainer = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('rounded-lg border border-border bg-surface overflow-hidden', className)}
      {...props}
    />
  ),
);
TableContainer.displayName = 'TableContainer';
