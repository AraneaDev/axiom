import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ChevronRight, FileText, GitCommit } from 'lucide-react';
import { Link, Navigate, useParams } from 'react-router';

import { reposApi, BlameLine } from '@/api/repos.api';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageLoader } from '@/components/ui/Spinner';
import { useRepoContext } from '@/hooks/useRepoContext';
import { formatRelative } from '@/lib/utils';

/**
 *
 */
export default function BlameView() {
  const { ref, '*': filePath } = useParams();
  const { currentRepo, basePath } = useRepoContext();

  const {
    data: blameLines,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['blame', currentRepo?.id, ref, filePath],
    queryFn: () => reposApi.getBlame(currentRepo!.id, ref!, filePath!),
    enabled: !!currentRepo?.id && !!ref && !!filePath,
  });

  if (!ref || !filePath) {
    return <Navigate to={basePath} replace />;
  }

  if (isLoading || !currentRepo) return <PageLoader />;

  if (isError || !blameLines) {
    return (
      <EmptyState
        icon={<FileText className="h-10 w-10" />}
        title="Blame not available"
        description={`Could not load blame for ${filePath}.`}
        action={
          <Link to={`${basePath}/blob/${ref}/${filePath}`}>
            <Button variant="secondary">
              <ArrowLeft className="h-4 w-4" /> Back to file
            </Button>
          </Link>
        }
      />
    );
  }

  const parts = filePath.split('/');

  // Group consecutive lines with same SHA for cleaner display
  const groups: { sha: string; author: string; date: string; lines: BlameLine[] }[] = [];
  for (const line of blameLines) {
    const last = groups[groups.length - 1];
    if (last && last.sha === line.sha) {
      last.lines.push(line);
    } else {
      groups.push({ sha: line.sha, author: line.author, date: line.date, lines: [line] });
    }
  }

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
                to={`${basePath}/tree/${ref}/${parts.slice(0, i + 1).join('/')}`}
                className="text-primary hover:underline"
              >
                {p}
              </Link>
            ) : (
              <span className="font-medium">{p}</span>
            )}
          </span>
        ))}
        <span className="ml-2 text-text-tertiary">(blame)</span>
      </div>

      <div className="flex items-center gap-2 mb-4">
        <Link to={`${basePath}/blob/${ref}/${filePath}`}>
          <Button variant="ghost" size="sm">
            <FileText className="h-4 w-4" /> Normal view
          </Button>
        </Link>
      </div>

      {/* Blame table */}
      <div className="rounded-lg border border-border bg-surface overflow-x-auto">
        <pre className="text-sm font-mono m-0 p-0">
          <table className="w-full border-collapse">
            <tbody>
              {groups.map((group, gi) =>
                group.lines.map((line, li) => (
                  <tr
                    key={`${gi}-${li}`}
                    className="hover:bg-surface-secondary border-b border-border/30"
                  >
                    {li === 0 ? (
                      <td
                        rowSpan={group.lines.length}
                        className="align-top px-3 py-1 text-xs text-text-secondary border-r border-border bg-surface-secondary w-[200px] min-w-[200px]"
                      >
                        <div className="flex items-center gap-1 mb-0.5">
                          <GitCommit className="h-3 w-3 shrink-0" />
                          <Link
                            to={`${basePath}/commits/${group.sha}`}
                            className="text-primary hover:underline font-mono"
                          >
                            {group.sha}
                          </Link>
                        </div>
                        <div className="text-text-tertiary truncate">
                          {group.author} &middot; {formatRelative(group.date)}
                        </div>
                      </td>
                    ) : null}
                    <td className="text-right pr-3 pl-2 py-0 text-text-tertiary select-none w-10 align-top text-xs leading-6 border-r border-border">
                      {line.lineNum}
                    </td>
                    <td className="pl-4 whitespace-pre leading-6 text-xs">{line.content || ' '}</td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </pre>
      </div>
    </div>
  );
}
