import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  GitCommit,
  FilePlus,
  FileMinus,
  FileEdit,
  Plus,
  Minus,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Loader2,
  ExternalLink,
  Rocket,
} from 'lucide-react';
import React from 'react';
import { Link, useParams } from 'react-router';

import { deploymentsApi } from '@/api/deployments.api';
import type { Deployment } from '@/api/deployments.api';
import { reposApi } from '@/api/repos.api';
import { statusChecksApi } from '@/api/status-checks.api';
import type { StatusCheck } from '@/api/status-checks.api';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageLoader } from '@/components/ui/Spinner';
import { useRepoContext } from '@/hooks/useRepoContext';
import { formatRelative } from '@/lib/utils';

function parseDiff(raw: string) {
  const files: {
    header: string;
    oldFile: string;
    newFile: string;
    hunks: { header: string; lines: { type: 'add' | 'del' | 'ctx'; content: string }[] }[];
  }[] = [];

  const fileSections = raw.split(/^diff --git /m).filter(Boolean);

  for (const section of fileSections) {
    const lines = section.split('\n');
    const header = 'diff --git ' + lines[0];

    let oldFile = '';
    let newFile = '';
    const hunks: (typeof files)[0]['hunks'] = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('--- ')) {
        oldFile = line.slice(4);
      } else if (line.startsWith('+++ ')) {
        newFile = line.slice(4);
      } else if (line.startsWith('@@')) {
        hunks.push({ header: line, lines: [] });
      } else if (hunks.length > 0) {
        const currentHunk = hunks[hunks.length - 1];
        if (line.startsWith('+')) {
          currentHunk.lines.push({ type: 'add', content: line.slice(1) });
        } else if (line.startsWith('-')) {
          currentHunk.lines.push({ type: 'del', content: line.slice(1) });
        } else {
          currentHunk.lines.push({
            type: 'ctx',
            content: line.startsWith(' ') ? line.slice(1) : line,
          });
        }
      }
    }

    files.push({ header, oldFile, newFile, hunks });
  }

  return files;
}

/**
 *
 */
export default function CommitDetail() {
  const { sha } = useParams();
  const { currentRepo, basePath } = useRepoContext();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['commit', currentRepo?.id, sha],
    queryFn: () => reposApi.getCommit(currentRepo!.id, sha!),
    enabled: !!currentRepo?.id && !!sha,
  });

  const { data: commitStatuses } = useQuery({
    queryKey: ['commitStatuses', currentRepo?.id, sha],
    queryFn: () => statusChecksApi.getCommitStatuses(currentRepo!.id, sha!),
    enabled: !!currentRepo?.id && !!sha,
  });

  const { data: commitDeployments } = useQuery({
    queryKey: ['commitDeployments', currentRepo?.id, sha],
    queryFn: () => deploymentsApi.getDeploymentsByCommit(currentRepo!.id, sha!),
    enabled: !!currentRepo?.id && !!sha,
  });

  if (isLoading || !currentRepo) return <PageLoader />;

  if (isError || !data) {
    return (
      <EmptyState
        icon={<GitCommit className="h-10 w-10" />}
        title="Commit not found"
        description={`Could not find commit ${sha?.slice(0, 8)}.`}
        action={
          <Link to={basePath}>
            <Button variant="secondary">
              <ArrowLeft className="h-4 w-4" /> Back to repository
            </Button>
          </Link>
        }
      />
    );
  }

  const commit = data.commit ?? data;
  const diffOutput = data.diff ?? '';
  const stats = data.stats ?? [];
  const files = parseDiff(diffOutput);
  const totalAdditions = stats.reduce((s, f) => s + f.additions, 0);
  const totalDeletions = stats.reduce((s, f) => s + f.deletions, 0);

  return (
    <div>
      {/* Header */}
      <div className="mb-4">
        <Link
          to={basePath}
          className="inline-flex items-center gap-1 text-sm text-primary hover:underline mb-3"
        >
          <ArrowLeft className="h-3 w-3" /> Back to repository
        </Link>
        <h1 className="text-xl font-bold mb-1">{commit.message}</h1>
        <div className="flex items-center gap-3 text-sm text-text-secondary">
          <span className="flex items-center gap-1">
            <GitCommit className="h-4 w-4" />
            <code className="font-mono">{commit.shortSha || commit.sha?.slice(0, 7)}</code>
          </span>
          <span>{commit.author}</span>
          <span>{formatRelative(commit.date)}</span>
        </div>
      </div>

      {/* Stats summary */}
      {stats.length > 0 && (
        <div className="flex items-center gap-4 mb-4 text-sm">
          <Badge variant="outline">
            {stats.length} file{stats.length !== 1 ? 's' : ''} changed
          </Badge>
          <span className="flex items-center gap-1 text-success">
            <Plus className="h-3 w-3" /> {totalAdditions}
          </span>
          <span className="flex items-center gap-1 text-danger">
            <Minus className="h-3 w-3" /> {totalDeletions}
          </span>
        </div>
      )}

      {/* Status checks */}
      {commitStatuses && commitStatuses.statuses.length > 0 && (
        <div className="rounded-lg border border-border bg-surface mb-4 p-4">
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-sm font-semibold">Status Checks</h2>
            <Badge
              variant={
                commitStatuses.state === 'success'
                  ? 'success'
                  : commitStatuses.state === 'failure'
                    ? 'danger'
                    : 'default'
              }
            >
              {commitStatuses.state}
            </Badge>
          </div>
          <div className="space-y-2">
            {commitStatuses.statuses.map((status: StatusCheck) => (
              <div key={status.id} className="flex items-center gap-2 text-sm">
                {status.state === 'SUCCESS' ? (
                  <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
                ) : status.state === 'FAILURE' ? (
                  <XCircle className="h-4 w-4 text-danger shrink-0" />
                ) : status.state === 'ERROR' ? (
                  <AlertCircle className="h-4 w-4 text-danger shrink-0" />
                ) : (
                  <Loader2 className="h-4 w-4 text-warning animate-spin shrink-0" />
                )}
                <span className="flex-1">{status.context}</span>
                {status.description && (
                  <span className="text-xs text-text-tertiary">{status.description}</span>
                )}
                {status.targetUrl && (
                  <a
                    href={status.targetUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                    title="View details"
                  >
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Deployment badges */}
      {commitDeployments && commitDeployments.length > 0 && (
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <Rocket className="h-4 w-4 text-text-secondary shrink-0" />
          {commitDeployments.map((d: Deployment) => (
            <Badge
              key={d.id}
              variant={
                d.status === 'SUCCESS'
                  ? 'success'
                  : d.status === 'FAILURE'
                    ? 'danger'
                    : d.status === 'IN_PROGRESS'
                      ? 'warning'
                      : 'default'
              }
              size="sm"
            >
              deployed to {d.environment?.name || 'unknown'}
            </Badge>
          ))}
        </div>
      )}

      {/* File stats list */}
      {stats.length > 0 && (
        <div className="rounded-lg border border-border bg-surface mb-4 divide-y divide-border">
          {stats.map((s) => (
            <div key={s.file} className="flex items-center gap-3 px-4 py-2 text-sm">
              {s.additions > 0 && s.deletions > 0 ? (
                <FileEdit className="h-4 w-4 text-warning shrink-0" />
              ) : s.additions > 0 ? (
                <FilePlus className="h-4 w-4 text-success shrink-0" />
              ) : (
                <FileMinus className="h-4 w-4 text-danger shrink-0" />
              )}
              <span className="font-mono text-xs flex-1 truncate">{s.file}</span>
              <span className="text-success text-xs">+{s.additions}</span>
              <span className="text-danger text-xs">-{s.deletions}</span>
            </div>
          ))}
        </div>
      )}

      {/* Diff */}
      {files.map((file, fi) => (
        <div key={fi} className="rounded-lg border border-border bg-surface mb-4 overflow-hidden">
          <div className="px-4 py-2 bg-surface-secondary border-b border-border text-sm font-mono">
            {file.newFile?.replace('b/', '') || file.oldFile?.replace('a/', '')}
          </div>
          <div className="overflow-x-auto">
            <pre className="text-xs font-mono m-0 p-0">
              <table className="w-full border-collapse">
                <tbody>
                  {file.hunks.map((hunk, hi) => (
                    <React.Fragment key={`hunk-${hi}`}>
                      <tr>
                        <td
                          colSpan={3}
                          className="px-4 py-1 text-text-tertiary bg-primary-light text-xs"
                        >
                          {hunk.header}
                        </td>
                      </tr>
                      {hunk.lines.map((line, li) => (
                        <tr
                          key={`${hi}-${li}`}
                          className={
                            line.type === 'add'
                              ? 'bg-success/10'
                              : line.type === 'del'
                                ? 'bg-danger/10'
                                : ''
                          }
                        >
                          <td className="w-6 text-center text-text-tertiary select-none px-1">
                            {line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '}
                          </td>
                          <td className="pl-2 whitespace-pre leading-5">{line.content || ' '}</td>
                        </tr>
                      ))}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </pre>
          </div>
        </div>
      ))}

      {!diffOutput && (
        <div className="text-sm text-text-secondary text-center py-8">
          No diff available for this commit.
        </div>
      )}
    </div>
  );
}
