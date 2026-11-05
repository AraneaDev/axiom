import { AlertTriangle, RefreshCw, RotateCw } from 'lucide-react';
import { lazy, Suspense, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { CardSkeleton } from '@/components/ui/Skeleton';

const loadQueryBlock = () =>
  import('./QueryBlock').then((module) => ({ default: module.QueryBlock }));

/**
 * A live block that loads its widgets, charts and live hooks when one is first shown. Read-only
 * pages and editors that never show a block do not pay for them.
 *
 * That code can fail to load, typically when a deploy replaced it after the page was opened. The
 * failure stays in the block, so the page around it remains. A lazy component keeps its rejection
 * for good, so a retry needs a new one, and the boundary a new key to forget what it caught.
 * Chromium also remembers a failed import() until the document goes, without asking the network
 * again, so a retry that fails leaves only a reload.
 * @param root0
 * @param root0.target - The block's target as written in the Markdown
 */
export function LazyQueryBlock({ target }: { target: string }) {
  const [attempt, setAttempt] = useState(() => ({ key: 0, Block: lazy(loadQueryBlock) }));
  const retry = () => setAttempt(({ key }) => ({ key: key + 1, Block: lazy(loadQueryBlock) }));
  const { key, Block } = attempt;

  return (
    <ErrorBoundary
      key={key}
      fallback={
        <Card className="not-prose my-3 p-4">
          <div
            role="alert"
            className="flex flex-wrap items-center gap-3 text-sm text-text-secondary"
          >
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span className="flex-1 min-w-0">
              {key === 0
                ? 'This block could not be loaded.'
                : 'This block could not be loaded. Reloading the page may help.'}
            </span>
            {key === 0 ? (
              <Button type="button" size="sm" variant="outline" onClick={retry}>
                <RefreshCw className="h-4 w-4" /> Try again
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => window.location.reload()}
              >
                <RotateCw className="h-4 w-4" /> Reload page
              </Button>
            )}
          </div>
        </Card>
      }
    >
      <Suspense
        fallback={
          <div className="not-prose my-3" data-testid="query-block-loading">
            <CardSkeleton />
          </div>
        }
      >
        <Block target={target} />
      </Suspense>
    </ErrorBoundary>
  );
}
