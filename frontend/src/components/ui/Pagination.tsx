import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { forwardRef, type HTMLAttributes } from 'react';

import { Button } from './Button';

import { cn } from '@/lib/utils';

interface PaginationProps extends HTMLAttributes<HTMLDivElement> {
  total: number;
  limit: number;
  offset: number;
  onPageChange: (offset: number) => void;
  onLimitChange?: (limit: number) => void;
  pageSizeOptions?: number[];
}

export const Pagination = forwardRef<HTMLDivElement, PaginationProps>(
  (
    {
      className,
      total,
      limit,
      offset,
      onPageChange,
      onLimitChange,
      pageSizeOptions = [10, 25, 50, 100],
      ...props
    },
    ref,
  ) => {
    const currentPage = Math.floor(offset / limit) + 1;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const startItem = total === 0 ? 0 : offset + 1;
    const endItem = Math.min(offset + limit, total);

    const canGoPrev = offset > 0;
    const canGoNext = offset + limit < total;

    const goToPage = (page: number) => {
      const newOffset = (page - 1) * limit;
      onPageChange(Math.max(0, Math.min(newOffset, (totalPages - 1) * limit)));
    };

    return (
      <div
        ref={ref}
        className={cn('flex items-center justify-between gap-4 py-3', className)}
        {...props}
      >
        <div className="flex items-center gap-2 text-sm text-text-secondary">
          <span>
            Showing {startItem}-{endItem} of {total}
          </span>
          {onLimitChange && (
            <select
              value={limit}
              onChange={(e) => {
                onLimitChange(parseInt(e.target.value));
                onPageChange(0);
              }}
              className="ml-2 rounded-md border border-border bg-surface px-2 py-1 text-xs text-text focus:border-border-focus focus:outline-none"
            >
              {pageSizeOptions.map((size) => (
                <option key={size} value={size}>
                  {size} / page
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="xs"
            onClick={() => goToPage(1)}
            disabled={!canGoPrev}
            title="First page"
          >
            <ChevronsLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => goToPage(currentPage - 1)}
            disabled={!canGoPrev}
            title="Previous page"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>

          <span className="px-3 text-sm text-text-secondary">
            Page {currentPage} of {totalPages}
          </span>

          <Button
            variant="ghost"
            size="xs"
            onClick={() => goToPage(currentPage + 1)}
            disabled={!canGoNext}
            title="Next page"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => goToPage(totalPages)}
            disabled={!canGoNext}
            title="Last page"
          >
            <ChevronsRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    );
  },
);
Pagination.displayName = 'Pagination';
