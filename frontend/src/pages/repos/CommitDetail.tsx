import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  GitCommit,
  FilePlus,
  FileMinus,
  FileEdit,
  FileText,
  Plus,
  Minus,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Loader2,
  ExternalLink,
  Rocket,
  ChevronUp,
  ChevronDown,
  ChevronRight,
  PanelLeftClose,
  PanelLeft,
} from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';

import { deploymentsApi } from '@/api/deployments.api';
import type { Deployment } from '@/api/deployments.api';
import { reposApi } from '@/api/repos.api';
import { statusChecksApi } from '@/api/status-checks.api';
import type { StatusCheck } from '@/api/status-checks.api';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { DetailSkeleton } from '@/components/ui/Skeleton';
import { useRepoContext } from '@/hooks/useRepoContext';
import { cn, formatRelative } from '@/lib/utils';

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

  const [activeFileIndex, setActiveFileIndex] = useState(0);
  const [fileTreeOpen, setFileTreeOpen] = useState(true);

  const fileCount = data?.stats?.length ?? 0;

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveFileIndex((prev) => (prev < fileCount - 1 ? prev + 1 : prev));
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveFileIndex((prev) => (prev > 0 ? prev - 1 : prev));
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [fileCount]);

  if (isLoading || !currentRepo) return <DetailSkeleton />;

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

  function getFileIcon(s: { additions: number; deletions: number }) {
    if (s.additions > 0 && s.deletions > 0)
      return <FileEdit className="h-3.5 w-3.5 text-warning shrink-0" />;
    if (s.additions > 0) return <FilePlus className="h-3.5 w-3.5 text-success shrink-0" />;
    return <FileMinus className="h-3.5 w-3.5 text-danger shrink-0" />;
  }

  function getChangeType(s: { additions: number; deletions: number }) {
    if (s.additions > 0 && s.deletions > 0) return 'Modified';
    if (s.additions > 0 && s.deletions === 0) return 'Added';
    if (s.deletions > 0 && s.additions === 0) return 'Deleted';
    return 'Modified';
  }

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
        <Card className="mb-4 p-4">
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
        </Card>
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

      {/* File navigation bar */}
      {stats.length > 0 && (
        <Card className="mb-4 overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-2 bg-surface-secondary border-b border-border">
            <Button
              variant="ghost"
              size="xs"
              onClick={() => setFileTreeOpen(!fileTreeOpen)}
              title={fileTreeOpen ? 'Collapse file list' : 'Expand file list'}
            >
              {fileTreeOpen ? (
                <PanelLeftClose className="h-4 w-4" />
              ) : (
                <PanelLeft className="h-4 w-4" />
              )}
            </Button>
            <FileText className="h-4 w-4 text-text-tertiary" />
            <span className="text-sm font-medium text-text-secondary">
              File {activeFileIndex + 1} of {stats.length}
            </span>
            <div className="ml-auto flex items-center gap-1">
              <Button
                variant="ghost"
                size="xs"
                onClick={() => setActiveFileIndex((p) => Math.max(0, p - 1))}
                disabled={activeFileIndex === 0}
                title="Previous file (k)"
              >
                <ChevronUp className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="xs"
                onClick={() => setActiveFileIndex((p) => Math.min(stats.length - 1, p + 1))}
                disabled={activeFileIndex === stats.length - 1}
                title="Next file (j)"
              >
                <ChevronDown className="h-4 w-4" />
              </Button>
            </div>
          </div>
          {fileTreeOpen && (
            <div className="max-h-64 overflow-y-auto divide-y divide-border">
              {stats.map((s, i) => (
                <Button
                  key={s.file}
                  variant="ghost"
                  size="sm"
                  onClick={() => setActiveFileIndex(i)}
                  className={cn(
                    'w-full justify-start rounded-none px-4 py-1.5',
                    i === activeFileIndex ? 'bg-primary-light' : '',
                  )}
                >
                  {i === activeFileIndex && (
                    <ChevronRight className="h-3 w-3 text-primary shrink-0" />
                  )}
                  {getFileIcon(s)}
                  <span className="font-mono text-xs truncate">{s.file}</span>
                  <Badge
                    className="ml-auto"
                    variant={
                      getChangeType(s) === 'Added'
                        ? 'success'
                        : getChangeType(s) === 'Deleted'
                          ? 'danger'
                          : 'warning'
                    }
                    size="sm"
                  >
                    {getChangeType(s)}
                  </Badge>
                  <span className="text-success text-xs">+{s.additions}</span>
                  <span className="text-danger text-xs">-{s.deletions}</span>
                </Button>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* Diff -- carousel: show only active file */}
      {stats[activeFileIndex] &&
        (() => {
          const activeStat = stats[activeFileIndex];
          const activeFile = files.find(
            (f) =>
              f.newFile?.replace('b/', '') === activeStat.file ||
              f.oldFile?.replace('a/', '') === activeStat.file,
          );
          if (!activeFile)
            return (
              <Card className="p-8 text-center text-text-secondary text-sm">
                No diff available for this file.
              </Card>
            );
          return (
            <Card key={activeFileIndex} className="mb-4 overflow-hidden">
              <div className="px-4 py-2 bg-surface-secondary border-b border-border text-sm font-mono flex items-center gap-2">
                {getFileIcon(activeStat)}
                <span className="truncate">{activeStat.file}</span>
                <span className="flex items-center gap-2 text-xs shrink-0 ml-auto">
                  <span className="text-success">+{activeStat.additions}</span>
                  <span className="text-danger">-{activeStat.deletions}</span>
                </span>
              </div>
              <div className="overflow-x-auto">
                <pre className="text-xs font-mono m-0 p-0">
                  <table className="w-full border-collapse">
                    <tbody>
                      {activeFile.hunks.map((hunk, hi) => (
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
                              <td className="pl-2 whitespace-pre leading-5">
                                {line.content || ' '}
                              </td>
                            </tr>
                          ))}
                        </React.Fragment>
                      ))}
                    </tbody>
                  </table>
                </pre>
              </div>
            </Card>
          );
        })()}

      {!diffOutput && (
        <div className="text-sm text-text-secondary text-center py-8">
          No diff available for this commit.
        </div>
      )}
    </div>
  );
}
