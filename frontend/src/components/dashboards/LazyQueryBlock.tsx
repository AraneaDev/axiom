import { lazy, Suspense } from 'react';

import { CardSkeleton } from '@/components/ui/Skeleton';

const QueryBlock = lazy(() =>
  import('./QueryBlock').then((module) => ({ default: module.QueryBlock })),
);

/**
 * A live block that loads its widgets, charts and live hooks when one is first shown. Read-only
 * pages and editors that never show a block do not pay for them.
 * @param root0
 * @param root0.target - The block's target as written in the Markdown
 */
export function LazyQueryBlock({ target }: { target: string }) {
  return (
    <Suspense
      fallback={
        <div className="not-prose my-3" data-testid="query-block-loading">
          <CardSkeleton />
        </div>
      }
    >
      <QueryBlock target={target} />
    </Suspense>
  );
}
