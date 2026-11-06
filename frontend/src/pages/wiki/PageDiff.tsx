import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, GitCompare } from 'lucide-react';
import { useParams, useSearchParams } from 'react-router';

import { wikiApi } from '@/api/wiki.api';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { Card } from '@/components/ui/Card';
import { PageLoader } from '@/components/ui/Spinner';
import { cn, formatDate } from '@/lib/utils';

import { useWikiContext } from './WikiLayout';

/**
 * Side-by-side version comparison view for wiki pages.
 * Renders structured diff with added/removed line highlighting.
 */
export default function PageDiff() {
  const { org, team, space: spaceSlug, page: pageSlug } = useParams();
  const [searchParams] = useSearchParams();
  const { currentSpace } = useWikiContext();

  const from = parseInt(searchParams.get('from') ?? '', 10);
  const to = parseInt(searchParams.get('to') ?? '', 10);

  const {
    data: diff,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['pageDiff', currentSpace?.id, pageSlug, from, to],
    queryFn: () => wikiApi.diffVersions(currentSpace!.id, pageSlug!, from, to),
    enabled: !!currentSpace?.id && !!pageSlug && !isNaN(from) && !isNaN(to),
  });

  if (isLoading) return <PageLoader />;

  if (error || isNaN(from) || isNaN(to)) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <AlertTriangle className="h-8 w-8 text-danger mx-auto mb-2" />
          <p className="text-secondary">
            {isNaN(from) || isNaN(to)
              ? 'Invalid version numbers. Please select two versions to compare.'
              : 'Failed to load version diff'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <GitCompare className="h-5 w-5 text-text-secondary" />
          <h1 className="h2">Version Comparison</h1>
        </div>
        <div className="flex items-center gap-2">
          <ButtonLink
            to={`/${org}/${team}/wiki/${spaceSlug}/${pageSlug}/history`}
            variant="secondary"
            size="sm"
          >
            <ArrowLeft className="h-4 w-4" /> Back to history
          </ButtonLink>
        </div>
      </div>

      {/* Version metadata */}
      {diff && (
        <>
          <div className="grid grid-cols-2 gap-4 mb-6">
            <Card className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <Badge variant="default">v{diff.from.version}</Badge>
                <span className="text-sm font-medium">{diff.from.title}</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-text-secondary">
                <Avatar name={diff.from.author.displayName} size="sm" />
                <span>{diff.from.author.displayName}</span>
                <span>{formatDate(diff.from.createdAt)}</span>
              </div>
              {diff.from.changeDescription && (
                <p className="mt-2 text-xs text-text-tertiary italic">
                  {diff.from.changeDescription}
                </p>
              )}
            </Card>
            <Card className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <Badge variant="primary">v{diff.to.version}</Badge>
                <span className="text-sm font-medium">{diff.to.title}</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-text-secondary">
                <Avatar name={diff.to.author.displayName} size="sm" />
                <span>{diff.to.author.displayName}</span>
                <span>{formatDate(diff.to.createdAt)}</span>
              </div>
              {diff.to.changeDescription && (
                <p className="mt-2 text-xs text-text-tertiary italic">
                  {diff.to.changeDescription}
                </p>
              )}
            </Card>
          </div>

          {/* Title diff */}
          {diff.from.title !== diff.to.title && (
            <Card className="mb-4 p-4">
              <h3 className="text-sm font-semibold mb-2">Title changed</h3>
              <div className="flex gap-4 text-sm">
                <span className="bg-danger-light text-danger px-2 py-1 rounded line-through">
                  {diff.from.title}
                </span>
                <span className="bg-success-light text-success px-2 py-1 rounded">
                  {diff.to.title}
                </span>
              </div>
            </Card>
          )}

          {/* Body diff */}
          <Card className="overflow-hidden">
            <div className="px-4 py-2 border-b border-border bg-surface-secondary">
              <h3 className="text-sm font-semibold">Content changes</h3>
            </div>
            <div className="p-4 font-mono text-sm overflow-x-auto">
              {diff.changes.map((change, i) => {
                const lines = change.value.split('\n');
                // Remove trailing empty string from split
                if (lines[lines.length - 1] === '') lines.pop();

                return lines.map((line, j) => (
                  <div
                    key={`${i}-${j}`}
                    className={cn(
                      'px-2 py-0.5 whitespace-pre-wrap',
                      change.added && 'bg-success-light text-success',
                      change.removed && 'bg-danger-light text-danger line-through',
                      !change.added && !change.removed && 'text-text-secondary',
                    )}
                  >
                    <span className="select-none mr-3 text-text-tertiary">
                      {change.added ? '+' : change.removed ? '-' : ' '}
                    </span>
                    {line || '\u00A0'}
                  </div>
                ));
              })}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
