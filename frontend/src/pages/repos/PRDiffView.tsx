import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Rows3, Columns2, Plus, X, MessageSquare } from 'lucide-react';
import { useRef, useState } from 'react';

import type { CommitInfo } from '@/api/repos.api';
import { reposApi } from '@/api/repos.api';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';

interface CommentingOn {
  filePath: string;
  line: number;
}

interface SplitLine {
  left: { num: number | null; content: string; type: 'same' | 'del' | 'empty' };
  right: { num: number | null; content: string; type: 'same' | 'add' | 'empty' };
}

function parseDiffToSplit(raw: string): { file: string; lines: SplitLine[] }[] {
  const files: { file: string; lines: SplitLine[] }[] = [];
  const chunks = raw.split(/^diff --git /m).filter(Boolean);

  for (const chunk of chunks) {
    const linesRaw = chunk.split('\n');
    const headerMatch = linesRaw[0]?.match(/a\/(.+?) b\//);
    const file = headerMatch?.[1] ?? 'unknown';
    const splitLines: SplitLine[] = [];

    let leftNum = 0;
    let rightNum = 0;

    for (const line of linesRaw) {
      if (line.startsWith('@@')) {
        const hunkMatch = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
        if (hunkMatch) {
          leftNum = parseInt(hunkMatch[1], 10) - 1;
          rightNum = parseInt(hunkMatch[2], 10) - 1;
        }
        splitLines.push({
          left: { num: null, content: line, type: 'same' },
          right: { num: null, content: line, type: 'same' },
        });
        continue;
      }
      if (
        line.startsWith('---') ||
        line.startsWith('+++') ||
        line.startsWith('index ') ||
        line.startsWith('new file') ||
        line.startsWith('deleted file')
      ) {
        continue;
      }
      if (line.startsWith('-')) {
        leftNum++;
        splitLines.push({
          left: { num: leftNum, content: line.slice(1), type: 'del' },
          right: { num: null, content: '', type: 'empty' },
        });
      } else if (line.startsWith('+')) {
        rightNum++;
        splitLines.push({
          left: { num: null, content: '', type: 'empty' },
          right: { num: rightNum, content: line.slice(1), type: 'add' },
        });
      } else if (line.length > 0 || line === '') {
        leftNum++;
        rightNum++;
        splitLines.push({
          left: {
            num: leftNum,
            content: line.startsWith(' ') ? line.slice(1) : line,
            type: 'same',
          },
          right: {
            num: rightNum,
            content: line.startsWith(' ') ? line.slice(1) : line,
            type: 'same',
          },
        });
      }
    }
    if (splitLines.length > 0) {
      files.push({ file, lines: splitLines });
    }
  }
  return files;
}

interface InlineCommentFormProps {
  onCancel: () => void;
  onSubmit: (body: string) => void;
  isPending: boolean;
}

function InlineCommentForm({ onCancel, onSubmit, isPending }: InlineCommentFormProps) {
  const [body, setBody] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  return (
    <div className="px-3 py-2 bg-surface-secondary border-t border-b border-border">
      <textarea
        ref={textareaRef}
        autoFocus
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Leave a comment..."
        rows={3}
        className="w-full rounded border border-border bg-surface text-text text-xs font-sans p-2 resize-none focus:outline-none focus:ring-1 focus:ring-border-focus"
      />
      <div className="flex items-center gap-2 mt-2 justify-end">
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={isPending}>
          <X className="h-3.5 w-3.5" /> Cancel
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={!body.trim() || isPending}
          onClick={() => onSubmit(body)}
        >
          <MessageSquare className="h-3.5 w-3.5" /> Comment
        </Button>
      </div>
    </div>
  );
}

interface SplitDiffViewProps {
  rawDiff: string;
  repoId: string;
  prNumber: number;
}

function SplitDiffView({ rawDiff, repoId, prNumber }: SplitDiffViewProps) {
  const files = parseDiffToSplit(rawDiff);
  const [commentingOn, setCommentingOn] = useState<CommentingOn | null>(null);
  const queryClient = useQueryClient();
  const toast = useToast();

  const addCommentMutation = useMutation({
    mutationFn: (data: { body: string; filePath: string; line: number }) =>
      reposApi.addPRComment(repoId, prNumber, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pr', repoId, prNumber] });
      setCommentingOn(null);
      toast.success('Comment added');
    },
    onError: () => {
      toast.error('Failed to add comment');
    },
  });

  const bgClass = (type: string) =>
    type === 'del'
      ? 'bg-danger-light text-danger'
      : type === 'add'
        ? 'bg-success-light text-success'
        : type === 'empty'
          ? 'bg-surface-secondary'
          : '';

  return (
    <div className="space-y-4">
      {files.map((f) => (
        <div key={f.file} className="rounded-lg border border-border overflow-hidden">
          <div className="bg-surface-secondary px-3 py-1.5 text-xs font-mono text-text-secondary border-b border-border">
            {f.file}
          </div>
          <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
            <table className="w-full text-xs font-mono border-collapse">
              <tbody>
                {f.lines.map((row, i) => {
                  const lineNum = row.right.num ?? row.left.num;
                  const isCommentTarget =
                    commentingOn?.filePath === f.file && commentingOn?.line === lineNum;
                  return (
                    <>
                      <tr key={i} className="group relative">
                        <td className="w-10 text-right text-text-tertiary select-none px-1 border-r border-border bg-surface-secondary relative">
                          {row.left.num ?? ''}
                          {lineNum !== null && (
                            <button
                              title="Add comment"
                              onClick={() => setCommentingOn({ filePath: f.file, line: lineNum })}
                              className="absolute left-0 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center h-4 w-4 rounded bg-primary text-text-inverse"
                            >
                              <Plus className="h-2.5 w-2.5" />
                            </button>
                          )}
                        </td>
                        <td className={`w-1/2 px-2 py-0 whitespace-pre ${bgClass(row.left.type)}`}>
                          {row.left.content}
                        </td>
                        <td className="w-10 text-right text-text-tertiary select-none px-1 border-r border-l border-border bg-surface-secondary">
                          {row.right.num ?? ''}
                        </td>
                        <td className={`w-1/2 px-2 py-0 whitespace-pre ${bgClass(row.right.type)}`}>
                          {row.right.content}
                        </td>
                      </tr>
                      {isCommentTarget && (
                        <tr key={`comment-${i}`}>
                          <td colSpan={4}>
                            <InlineCommentForm
                              onCancel={() => setCommentingOn(null)}
                              onSubmit={(body) =>
                                addCommentMutation.mutate({ body, filePath: f.file, line: lineNum })
                              }
                              isPending={addCommentMutation.isPending}
                            />
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

interface UnifiedDiffViewProps {
  rawDiff: string;
  repoId: string;
  prNumber: number;
}

function UnifiedDiffView({ rawDiff, repoId, prNumber }: UnifiedDiffViewProps) {
  const [commentingOn, setCommentingOn] = useState<CommentingOn | null>(null);
  const queryClient = useQueryClient();
  const toast = useToast();

  const addCommentMutation = useMutation({
    mutationFn: (data: { body: string; filePath: string; line: number }) =>
      reposApi.addPRComment(repoId, prNumber, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pr', repoId, prNumber] });
      setCommentingOn(null);
      toast.success('Comment added');
    },
    onError: () => {
      toast.error('Failed to add comment');
    },
  });

  // Parse unified diff to track file and line numbers
  const parsedLines: {
    raw: string;
    filePath: string;
    lineNum: number | null;
    index: number;
  }[] = [];

  let currentFile = '';
  let rightLineNum = 0;

  rawDiff.split('\n').forEach((line, i) => {
    const fileMatch = line.match(/^diff --git a\/.+? b\/(.+)$/);
    if (fileMatch) {
      currentFile = fileMatch[1];
      rightLineNum = 0;
      parsedLines.push({ raw: line, filePath: currentFile, lineNum: null, index: i });
      return;
    }
    if (line.startsWith('@@')) {
      const hunkMatch = line.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (hunkMatch) rightLineNum = parseInt(hunkMatch[1], 10) - 1;
      parsedLines.push({ raw: line, filePath: currentFile, lineNum: null, index: i });
      return;
    }
    if (line.startsWith('+') && !line.startsWith('+++')) {
      rightLineNum++;
      parsedLines.push({ raw: line, filePath: currentFile, lineNum: rightLineNum, index: i });
      return;
    }
    if (line.startsWith('-') && !line.startsWith('---')) {
      parsedLines.push({ raw: line, filePath: currentFile, lineNum: null, index: i });
      return;
    }
    if (!line.startsWith('---') && !line.startsWith('+++') && !line.startsWith('index ') && !line.startsWith('new file') && !line.startsWith('deleted file')) {
      if (line.length > 0 || line === '') rightLineNum++;
    }
    parsedLines.push({ raw: line, filePath: currentFile, lineNum: null, index: i });
  });

  return (
    <pre className="rounded-lg border border-border bg-surface text-xs font-mono overflow-x-auto max-h-[600px] overflow-y-auto">
      {parsedLines.map((pl, i) => {
        const isCommentTarget =
          commentingOn?.filePath === pl.filePath && commentingOn?.line === pl.lineNum;
        const lineClass =
          pl.raw.startsWith('+') && !pl.raw.startsWith('+++')
            ? 'text-success bg-success-light'
            : pl.raw.startsWith('-') && !pl.raw.startsWith('---')
              ? 'text-danger bg-danger-light'
              : pl.raw.startsWith('@@')
                ? 'text-primary bg-primary-light'
                : '';
        return (
          <>
            <div key={i} className={`group relative flex ${lineClass}`}>
              <span className="flex-1 px-4 py-0 whitespace-pre">{pl.raw}</span>
              {pl.lineNum !== null && (
                <button
                  title="Add comment"
                  onClick={() =>
                    setCommentingOn({ filePath: pl.filePath, line: pl.lineNum as number })
                  }
                  className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center h-4 w-4 rounded bg-primary text-text-inverse shrink-0 mr-1 self-center"
                >
                  <Plus className="h-2.5 w-2.5" />
                </button>
              )}
            </div>
            {isCommentTarget && (
              <div key={`comment-${i}`} className="block">
                <InlineCommentForm
                  onCancel={() => setCommentingOn(null)}
                  onSubmit={(body) =>
                    addCommentMutation.mutate({
                      body,
                      filePath: pl.filePath,
                      line: pl.lineNum as number,
                    })
                  }
                  isPending={addCommentMutation.isPending}
                />
              </div>
            )}
          </>
        );
      })}
    </pre>
  );
}

interface PRDiffViewProps {
  commits: CommitInfo[] | undefined;
  diff:
    | { stats?: { file: string; additions: number; deletions: number }[]; diff?: string }
    | undefined;
  diffView: 'unified' | 'split';
  onDiffViewChange: (view: 'unified' | 'split') => void;
  repoId: string | undefined;
  prNumber: number;
}

/**
 *
 * @param root0
 * @param root0.commits
 * @param root0.diff
 * @param root0.diffView
 * @param root0.onDiffViewChange
 * @param root0.repoId
 * @param root0.prNumber
 */
export function PRDiffView({
  commits,
  diff,
  diffView,
  onDiffViewChange,
  repoId,
  prNumber,
}: PRDiffViewProps) {
  return (
    <>
      {/* Commits */}
      {commits && commits.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold mb-2">Commits ({commits.length})</h2>
          <div className="rounded-lg border border-border bg-surface divide-y divide-border">
            {commits.map((c: CommitInfo) => (
              <div key={c.sha} className="flex items-center gap-3 px-4 py-2">
                <code className="text-xs text-text-secondary font-mono">{c.shortSha}</code>
                <span className="text-sm flex-1 truncate">{c.message}</span>
                <span className="text-xs text-text-secondary">{c.author}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Diff stats */}
      {diff?.stats && diff.stats.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold mb-2">Changed Files ({diff.stats.length})</h2>
          <div className="rounded-lg border border-border bg-surface divide-y divide-border">
            {diff.stats.map((s) => (
              <div key={s.file} className="flex items-center gap-3 px-4 py-2 text-sm">
                <span className="flex-1 font-mono text-xs truncate">{s.file}</span>
                <span className="text-success text-xs">+{s.additions}</span>
                <span className="text-danger text-xs">-{s.deletions}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Diff content */}
      {diff?.diff && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold">Diff</h2>
            <div className="flex items-center rounded-lg border border-border bg-surface overflow-hidden">
              <Button
                size="sm"
                variant={diffView === 'unified' ? 'primary' : 'ghost'}
                className="rounded-none border-0"
                onClick={() => onDiffViewChange('unified')}
              >
                <Rows3 className="h-3.5 w-3.5" /> Unified
              </Button>
              <Button
                size="sm"
                variant={diffView === 'split' ? 'primary' : 'ghost'}
                className="rounded-none border-0"
                onClick={() => onDiffViewChange('split')}
              >
                <Columns2 className="h-3.5 w-3.5" /> Split
              </Button>
            </div>
          </div>
          {diffView === 'unified' ? (
            repoId ? (
              <UnifiedDiffView rawDiff={diff.diff} repoId={repoId} prNumber={prNumber} />
            ) : (
              <pre className="rounded-lg border border-border bg-surface p-4 text-xs font-mono overflow-x-auto max-h-[600px] overflow-y-auto">
                {diff.diff.split('\n').map((line: string, i: number) => (
                  <div
                    key={i}
                    className={
                      line.startsWith('+') && !line.startsWith('+++')
                        ? 'text-success bg-success-light'
                        : line.startsWith('-') && !line.startsWith('---')
                          ? 'text-danger bg-danger-light'
                          : line.startsWith('@@')
                            ? 'text-primary bg-primary-light'
                            : ''
                    }
                  >
                    {line}
                  </div>
                ))}
              </pre>
            )
          ) : repoId ? (
            <SplitDiffView rawDiff={diff.diff} repoId={repoId} prNumber={prNumber} />
          ) : (
            <SplitDiffView rawDiff={diff.diff} repoId="" prNumber={prNumber} />
          )}
        </div>
      )}
    </>
  );
}
