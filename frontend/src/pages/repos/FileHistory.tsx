import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ChevronRight, GitCommit, FileText } from 'lucide-react';
import { Link, Navigate, useParams } from 'react-router';

import { reposApi } from '@/api/repos.api';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageLoader } from '@/components/ui/Spinner';
import { useRepoContext } from '@/hooks/useRepoContext';
import { formatRelative } from '@/lib/utils';

/**
 *
 */
export default function FileHistory() {
  const { ref, '*': filePath } = useParams();
  const { currentRepo, basePath } = useRepoContext();

  const {
    data: commits,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['file-history', currentRepo?.id, ref, filePath],
    queryFn: () => reposApi.getFileLog(currentRepo!.id, ref!, filePath!, 50),
    enabled: !!currentRepo?.id && !!ref && !!filePath,
  });

  if (!ref || !filePath) {
    return <Navigate to={basePath} replace />;
  }

  if (isLoading || !currentRepo) return <PageLoader />;

  if (isError) {
    return (
      <EmptyState
        icon={<FileText className="h-10 w-10" />}
        title="History not available"
        description={`Could not load history for ${filePath}.`}
        action={
          <Link to={`${basePath}/blob/${encodeURIComponent(ref!)}/${filePath}`}>
            <Button variant="secondary">
              <ArrowLeft className="h-4 w-4" /> Back to file
            </Button>
          </Link>
        }
      />
    );
  }

  const parts = filePath.split('/');

  return (
    <div>
      {/* Breadcrumbs */}
      <div className="flex items-center gap-1 mb-4 text-sm flex-wrap">
        <Link to={basePath} className="text-primary hover:underline">
          {currentRepo.slug}
        </Link>
        {parts.map((p, i) => (
          <span key={i} className="flex items-center gap-1">
            <ChevronRight className="h-3 w-3 text-text-secondary" />
            {i < parts.length - 1 ? (
              <Link
                to={`${basePath}/tree/${encodeURIComponent(ref!)}/${parts.slice(0, i + 1).join('/')}`}
                className="text-primary hover:underline"
              >
                {p}
              </Link>
            ) : (
              <Link
                to={`${basePath}/blob/${encodeURIComponent(ref!)}/${filePath}`}
                className="text-primary hover:underline font-medium"
              >
                {p}
              </Link>
            )}
          </span>
        ))}
        <span className="ml-2 text-text-tertiary">(history)</span>
      </div>

      <div className="flex items-center gap-2 mb-4">
        <Link to={`${basePath}/blob/${encodeURIComponent(ref!)}/${filePath}`}>
          <Button variant="ghost" size="sm">
            <FileText className="h-4 w-4" /> View file
          </Button>
        </Link>
      </div>

      {/* Commit list */}
      {commits && commits.length > 0 ? (
        <div className="rounded-lg border border-border bg-surface divide-y divide-border">
          {commits.map((c) => (
            <Link
              key={c.sha}
              to={`${basePath}/commits/${c.sha}`}
              className="flex items-center gap-3 px-4 py-3 hover:bg-surface-secondary transition-colors"
            >
              <GitCommit className="h-4 w-4 text-text-secondary shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{c.message}</p>
                <p className="text-xs text-text-secondary">
                  {c.author} &middot; {formatRelative(c.date)}
                </p>
              </div>
              <code className="text-xs text-text-secondary font-mono">{c.shortSha}</code>
            </Link>
          ))}
        </div>
      ) : (
        <p className="text-sm text-text-secondary text-center py-8">
          No commits found for this file.
        </p>
      )}
    </div>
  );
}
