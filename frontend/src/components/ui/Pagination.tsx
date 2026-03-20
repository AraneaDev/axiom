import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { forwardRef, type HTMLAttributes } from 'react';

import { Button } from './Button';
import { Select } from './Dropdown';

import { cn } from '@/lib/utils';

interface PaginationProps extends HTMLAttributes<HTMLDivElement> {
  total: number;
  limit: number;
  offset: number;
  onPageChange: (offset: number) => void;
  onLimitChange?: (limit: number) => void;
  pageSizeOptions?: number[];
}

/**
 * Offset-based pagination control with page navigation and optional page size selector.
 * Displays "Showing X-Y of Z" summary and first/prev/next/last page buttons.
 * @param props - Pagination configuration.
 * @param props.total - Total number of items across all pages.
 * @param props.limit - Number of items per page.
 * @param props.offset - Zero-based offset of the current page.
 * @param props.onPageChange - Callback fired with the new offset when navigating.
 * @param props.onLimitChange - Optional callback to change page size; renders a size selector when provided.
 * @param props.pageSizeOptions - Available page sizes for the selector. Defaults to [10, 25, 50, 100].
 */
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
            <Select
              value={String(limit)}
              onChange={(v) => {
                onLimitChange(parseInt(v as string));
                onPageChange(0);
              }}
              options={pageSizeOptions.map((size) => ({
                value: String(size),
                label: `${size} / page`,
              }))}
              className="ml-2"
            />
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

          <span className="inline-flex items-center justify-center rounded-lg bg-primary text-white px-3 py-1 text-sm font-medium shadow-sm">
            {currentPage} / {totalPages}
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
