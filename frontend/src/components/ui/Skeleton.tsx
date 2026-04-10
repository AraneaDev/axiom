import { Card } from '@/components/ui/Card';
import { cn } from '@/lib/utils';

/**
 *
 * @param root0
 * @param root0.className
 * @param root0.style
 */
export function Skeleton({
  className,
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div className={cn('animate-pulse rounded-md bg-surface-tertiary', className)} style={style} />
  );
}

/**
 *
 */
export function CardSkeleton() {
  return (
    <Card className="p-5">
      <div className="flex items-center gap-3 mb-3">
        <Skeleton className="h-10 w-10 rounded-md" />
        <div className="flex-1">
          <Skeleton className="h-4 w-32 mb-2" />
          <Skeleton className="h-3 w-20" />
        </div>
      </div>
      <Skeleton className="h-3 w-full mb-2" />
      <Skeleton className="h-3 w-3/4" />
    </Card>
  );
}

/**
 *
 * @param root0
 * @param root0.rows
 */
export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <Card className="divide-y divide-border">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 p-4">
          <Skeleton className="h-5 w-5 rounded-full" />
          <div className="flex-1">
            <Skeleton className="h-4 w-48 mb-1" />
            <Skeleton className="h-3 w-32" />
          </div>
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
      ))}
    </Card>
  );
}

/**
 *
 * @param root0
 * @param root0.rows
 * @param root0.cols
 */
export function TableSkeleton({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <Card>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 p-3 border-b border-border last:border-0">
          {Array.from({ length: cols }).map((_, j) => (
            <Skeleton
              key={j}
              className={cn('h-4', j === 0 ? 'w-12' : j === 1 ? 'flex-1' : 'w-20')}
            />
          ))}
        </div>
      ))}
    </Card>
  );
}

/**
 * Skeleton for kanban board pages -- 4 columns with card placeholders.
 */
export function BoardSkeleton() {
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <Skeleton className="h-7 w-48 mb-2" />
          <Skeleton className="h-4 w-20" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-8 w-24 rounded-md" />
          <Skeleton className="h-8 w-24 rounded-md" />
          <Skeleton className="h-8 w-28 rounded-md" />
        </div>
      </div>
      <Skeleton className="h-10 w-full rounded-lg mb-4" />
      <div className="flex gap-4 overflow-hidden">
        {Array.from({ length: 4 }).map((_, col) => (
          <div key={col} className="w-72 shrink-0">
            <div className="flex items-center gap-2 mb-2 px-1">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-6 rounded-full" />
            </div>
            <div className="rounded-lg bg-surface-secondary p-2 space-y-2 min-h-[200px]">
              {Array.from({ length: col % 2 === 0 ? 3 : 2 }).map((_, card) => (
                <div key={card} className="rounded-md border border-border bg-surface p-3">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Skeleton className="h-3.5 w-3.5 rounded" />
                    <Skeleton className="h-3 w-14" />
                    <Skeleton className="ml-auto h-4 w-4 rounded-full" />
                  </div>
                  <Skeleton className="h-4 w-full mb-1" />
                  <Skeleton className="h-4 w-3/4 mb-2" />
                  <div className="flex items-center justify-between">
                    <Skeleton className="h-4 w-16 rounded" />
                    <Skeleton className="h-6 w-6 rounded-full" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Skeleton for detail pages -- title area + body block on left, sidebar fields on right.
 */
export function DetailSkeleton() {
  return (
    <div className="flex flex-col lg:grid lg:grid-cols-[1fr_340px] gap-8">
      <div className="min-w-0">
        <div className="flex items-start gap-3 mb-6">
          <Skeleton className="h-5 w-5 rounded mt-1.5 shrink-0" />
          <div className="flex-1">
            <Skeleton className="h-6 w-3/4 mb-2" />
            <Skeleton className="h-4 w-48" />
          </div>
        </div>
        <Card className="p-5 mb-8 space-y-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </Card>
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-start gap-3">
              <Skeleton className="h-8 w-8 rounded-full shrink-0" />
              <div className="flex-1">
                <Skeleton className="h-3 w-32 mb-2" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-4/5 mt-1" />
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="space-y-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center justify-between">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-5 w-28 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Skeleton for repo detail -- tab bar + file list rows.
 */
export function RepoSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Skeleton className="h-7 w-48 mb-2" />
          <Skeleton className="h-4 w-64" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-8 w-20 rounded-md" />
          <Skeleton className="h-8 w-8 rounded-md" />
        </div>
      </div>
      <div className="flex gap-3 border-b border-border pb-4">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-4 w-24" />
      </div>
      <div className="flex gap-2 border-b border-border pb-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-24 rounded-md" />
        ))}
      </div>
      <Card className="divide-y divide-border">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-2">
            <Skeleton className="h-4 w-4 rounded" />
            <Skeleton className={cn('h-4', i < 2 ? 'w-32' : i < 5 ? 'w-40' : 'w-28')} />
            <Skeleton className="ml-auto h-3 w-14" />
          </div>
        ))}
      </Card>
    </div>
  );
}

/**
 * Skeleton for analytics pages with a 2-column card grid.
 * @param root0
 * @param root0.showPeriod
 */
export function AnalyticsGridSkeleton({ showPeriod = true }: { showPeriod?: boolean }) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-64" />
        {showPeriod && <Skeleton className="h-9 w-36 rounded-md" />}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i}>
            <div className="px-5 py-4 border-b border-border">
              <Skeleton className="h-5 w-40" />
            </div>
            <div className="p-5">
              <Skeleton className="h-24 w-full mb-4" />
              {Array.from({ length: 3 }).map((_, j) => (
                <Skeleton key={j} className="h-6 w-full mb-2" />
              ))}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

/**
 * Skeleton for card grid layouts -- wiki spaces, etc.
 * @param root0
 * @param root0.count
 */
export function CardGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }).map((_, i) => (
        <Card key={i} className="p-5">
          <div className="flex items-center gap-3 mb-2">
            <Skeleton className="h-5 w-5 rounded" />
            <Skeleton className="h-5 w-32" />
          </div>
          <Skeleton className="h-3 w-full mb-2" />
          <Skeleton className="h-3 w-3/4 mb-2" />
          <Skeleton className="h-3 w-16 mt-2" />
        </Card>
      ))}
    </div>
  );
}
