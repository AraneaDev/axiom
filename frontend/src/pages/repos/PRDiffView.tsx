import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Rows3,
  Columns2,
  Plus,
  X,
  MessageSquare,
  FileText,
  FilePlus,
  FileMinus,
  FileEdit,
  ChevronUp,
  ChevronDown,
  ChevronRight,
  PanelLeftClose,
  PanelLeft,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import type { CommitInfo } from '@/api/repos.api';
import { reposApi } from '@/api/repos.api';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Textarea';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/utils';

interface CommentingOn {
  filePath: string;
  line: number;
}

interface SplitLine {
  left: { num: number | null; content: string; type: 'same' | 'del' | 'empty' };
  right: { num: number | null; content: string; type: 'same' | 'add' | 'empty' };
}

function splitDiffByFile(rawDiff: string): { file: string; rawDiff: string }[] {
  const chunks = rawDiff.split(/(?=^diff --git )/m);
  return chunks.filter(Boolean).map((chunk) => {
    const headerMatch = chunk.match(/^diff --git a\/(.+?) b\//);
    return { file: headerMatch?.[1] ?? 'unknown', rawDiff: chunk };
  });
}

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
      <Textarea
        ref={textareaRef}
        autoFocus
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Leave a comment..."
        rows={3}
        className="text-xs resize-none"
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
        <div
          key={f.file}
          id={`diff-${encodeURIComponent(f.file)}`}
          className="rounded-lg border border-border overflow-hidden"
        >
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

  // Parse unified diff into file-grouped sections for anchor support
  const fileGroups: {
    file: string;
    lines: { raw: string; filePath: string; lineNum: number | null; index: number }[];
  }[] = [];

  let currentFile = '';
  let rightLineNum = 0;
  let currentGroup: (typeof fileGroups)[0] | null = null;

  rawDiff.split('\n').forEach((line, i) => {
    const fileMatch = line.match(/^diff --git a\/.+? b\/(.+)$/);
    if (fileMatch) {
      currentFile = fileMatch[1];
      rightLineNum = 0;
      currentGroup = { file: currentFile, lines: [] };
      fileGroups.push(currentGroup);
      currentGroup.lines.push({ raw: line, filePath: currentFile, lineNum: null, index: i });
      return;
    }
    if (!currentGroup) {
      currentGroup = { file: '', lines: [] };
      fileGroups.push(currentGroup);
    }
    if (line.startsWith('@@')) {
      const hunkMatch = line.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (hunkMatch) rightLineNum = parseInt(hunkMatch[1], 10) - 1;
      currentGroup.lines.push({ raw: line, filePath: currentFile, lineNum: null, index: i });
      return;
    }
    if (line.startsWith('+') && !line.startsWith('+++')) {
      rightLineNum++;
      currentGroup.lines.push({
        raw: line,
        filePath: currentFile,
        lineNum: rightLineNum,
        index: i,
      });
      return;
    }
    if (line.startsWith('-') && !line.startsWith('---')) {
      currentGroup.lines.push({ raw: line, filePath: currentFile, lineNum: null, index: i });
      return;
    }
    if (
      !line.startsWith('---') &&
      !line.startsWith('+++') &&
      !line.startsWith('index ') &&
      !line.startsWith('new file') &&
      !line.startsWith('deleted file')
    ) {
      if (line.length > 0 || line === '') rightLineNum++;
    }
    currentGroup.lines.push({ raw: line, filePath: currentFile, lineNum: null, index: i });
  });

  return (
    <div className="space-y-4">
      {fileGroups.map((fg) => (
        <pre
          key={fg.file || fg.lines[0]?.index}
          id={fg.file ? `diff-${encodeURIComponent(fg.file)}` : undefined}
          className="rounded-lg border border-border bg-surface text-xs font-mono overflow-x-auto max-h-[600px] overflow-y-auto"
        >
          {fg.lines.map((pl, i) => {
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
      ))}
    </div>
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
  const [activeFileIndex, setActiveFileIndex] = useState(0);
  const [fileListOpen, setFileListOpen] = useState(true);

  const stats = diff?.stats ?? [];
  const diffText = diff?.diff;
  const fileChunks = useMemo(() => (diffText ? splitDiffByFile(diffText) : []), [diffText]);
  const fileCount = stats.length;

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

  const activeStat = stats[activeFileIndex];
  const activeChunk = activeStat ? fileChunks.find((c) => c.file === activeStat.file) : null;

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

      {/* File navigation + diff carousel */}
      {stats.length > 0 && (
        <div className="rounded-lg border border-border bg-surface overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-2 bg-surface-secondary border-b border-border">
            <Button
              variant="ghost"
              size="xs"
              onClick={() => setFileListOpen(!fileListOpen)}
              title={fileListOpen ? 'Collapse file list' : 'Expand file list'}
            >
              {fileListOpen ? (
                <PanelLeftClose className="h-4 w-4" />
              ) : (
                <PanelLeft className="h-4 w-4" />
              )}
            </Button>
            <FileText className="h-4 w-4 text-text-tertiary" />
            <span className="text-sm font-medium text-text-secondary">
              File {activeFileIndex + 1} of {stats.length}
            </span>
            <div className="ml-auto flex items-center gap-2">
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
              <div className="flex items-center gap-1">
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
          </div>
          {fileListOpen && (
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
        </div>
      )}

      {/* Active file diff */}
      {activeChunk && repoId && (
        <div className="rounded-lg border border-border bg-surface overflow-hidden">
          <div className="px-4 py-2 bg-surface-secondary border-b border-border text-sm font-mono flex items-center gap-2">
            {activeStat && getFileIcon(activeStat)}
            <span className="truncate">{activeStat?.file}</span>
            {activeStat && (
              <span className="flex items-center gap-2 text-xs shrink-0 ml-auto">
                <span className="text-success">+{activeStat.additions}</span>
                <span className="text-danger">-{activeStat.deletions}</span>
              </span>
            )}
          </div>
          <div className="overflow-x-auto">
            {diffView === 'unified' ? (
              <UnifiedDiffView rawDiff={activeChunk.rawDiff} repoId={repoId} prNumber={prNumber} />
            ) : (
              <SplitDiffView rawDiff={activeChunk.rawDiff} repoId={repoId} prNumber={prNumber} />
            )}
          </div>
        </div>
      )}

      {!diff?.diff && stats.length === 0 && (
        <div className="text-sm text-text-secondary text-center py-8">
          No diff available for this pull request.
        </div>
      )}
    </>
  );
}
