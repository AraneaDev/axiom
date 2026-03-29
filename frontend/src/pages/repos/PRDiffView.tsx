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
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';

import type { CommitInfo } from '@/api/repos.api';
import { reposApi } from '@/api/repos.api';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Textarea } from '@/components/ui/Textarea';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/utils';

interface CommentingOn {
  filePath: string;
  line: number;
}

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

function ActiveFileDiff({
  activeChunk,
  activeStat,
  diffView,
  repoId,
  prNumber,
}: {
  activeChunk: { file: string; rawDiff: string };
  activeStat?: { file: string; additions: number; deletions: number };
  diffView: 'unified' | 'split';
  repoId: string;
  prNumber: number;
}) {
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

  const parsed = useMemo(() => parseDiff(activeChunk.rawDiff), [activeChunk.rawDiff]);
  const activeFile = parsed[0];

  if (!activeFile || activeFile.hunks.length === 0) {
    return (
      <Card className="overflow-hidden">
        <div className="px-4 py-2 bg-surface-secondary border-b border-border text-sm font-mono flex items-center gap-2">
          {activeStat && getFileIcon(activeStat)}
          <span className="truncate">{activeStat?.file}</span>
        </div>
        <div className="px-4 py-8 text-center text-sm text-text-secondary">
          Binary file or no diff available.
        </div>
      </Card>
    );
  }

  if (diffView === 'split') {
    // Convert parsed hunks into paired split rows
    const splitRows: {
      left: { num: number | null; content: string; type: 'same' | 'del' | 'empty' };
      right: { num: number | null; content: string; type: 'same' | 'add' | 'empty' };
      hunkHeader?: string;
    }[] = [];

    let leftNum = 0;
    let rightNum = 0;

    for (const hunk of activeFile.hunks) {
      const hunkMatch = hunk.header.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (hunkMatch) {
        leftNum = parseInt(hunkMatch[1], 10) - 1;
        rightNum = parseInt(hunkMatch[2], 10) - 1;
      }
      splitRows.push({
        left: { num: null, content: '', type: 'same' },
        right: { num: null, content: '', type: 'same' },
        hunkHeader: hunk.header,
      });

      // Group consecutive del/add lines for side-by-side pairing
      let i = 0;
      while (i < hunk.lines.length) {
        const line = hunk.lines[i];
        if (line.type === 'ctx') {
          leftNum++;
          rightNum++;
          splitRows.push({
            left: { num: leftNum, content: line.content, type: 'same' },
            right: { num: rightNum, content: line.content, type: 'same' },
          });
          i++;
        } else {
          // Collect consecutive del then add
          const dels: typeof hunk.lines = [];
          const adds: typeof hunk.lines = [];
          while (i < hunk.lines.length && hunk.lines[i].type === 'del') {
            dels.push(hunk.lines[i]);
            i++;
          }
          while (i < hunk.lines.length && hunk.lines[i].type === 'add') {
            adds.push(hunk.lines[i]);
            i++;
          }
          const maxLen = Math.max(dels.length, adds.length);
          for (let j = 0; j < maxLen; j++) {
            const del = dels[j];
            const add = adds[j];
            if (del) leftNum++;
            if (add) rightNum++;
            splitRows.push({
              left: del
                ? { num: leftNum, content: del.content, type: 'del' }
                : { num: null, content: '', type: 'empty' },
              right: add
                ? { num: rightNum, content: add.content, type: 'add' }
                : { num: null, content: '', type: 'empty' },
            });
          }
        }
      }
    }

    const bgClass = (type: string) =>
      type === 'del'
        ? 'bg-danger/10 text-danger'
        : type === 'add'
          ? 'bg-success/10 text-success'
          : type === 'empty'
            ? 'bg-surface-secondary'
            : '';

    return (
      <Card className="overflow-hidden">
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
          <table className="w-full text-xs font-mono border-collapse">
            <tbody>
              {splitRows.map((row, i) => {
                if (row.hunkHeader) {
                  return (
                    <tr key={i}>
                      <td
                        colSpan={4}
                        className="px-4 py-1 text-text-tertiary bg-primary-light text-xs"
                      >
                        {row.hunkHeader}
                      </td>
                    </tr>
                  );
                }
                return (
                  <tr key={i} className="group">
                    <td className="w-10 text-right text-text-tertiary select-none px-1 border-r border-border bg-surface-secondary">
                      {row.left.num ?? ''}
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
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    );
  }

  // Unified view with parsed hunks
  let lineNum = 0;
  return (
    <Card className="overflow-hidden">
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
        <pre className="text-xs font-mono m-0 p-0">
          <table className="w-full border-collapse">
            <tbody>
              {activeFile.hunks.map((hunk, hi) => {
                const hunkMatch = hunk.header.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
                if (hunkMatch) lineNum = parseInt(hunkMatch[1], 10) - 1;
                return (
                  <Fragment key={hi}>
                    <tr>
                      <td
                        colSpan={3}
                        className="px-4 py-1 text-text-tertiary bg-primary-light text-xs"
                      >
                        {hunk.header}
                      </td>
                    </tr>
                    {hunk.lines.map((line, li) => {
                      if (line.type === 'add' || line.type === 'ctx') lineNum++;
                      const currentLine = line.type !== 'del' ? lineNum : null;
                      const isCommentTarget =
                        commentingOn?.filePath === activeChunk.file &&
                        commentingOn?.line === currentLine;
                      return (
                        <Fragment key={`${hi}-${li}`}>
                          <tr
                            className={cn(
                              'group',
                              line.type === 'add'
                                ? 'bg-success/10'
                                : line.type === 'del'
                                  ? 'bg-danger/10'
                                  : '',
                            )}
                          >
                            <td className="w-6 text-center text-text-tertiary select-none px-1 relative">
                              {line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '}
                              {currentLine !== null && (
                                <button
                                  title="Add comment"
                                  onClick={() =>
                                    setCommentingOn({
                                      filePath: activeChunk.file,
                                      line: currentLine,
                                    })
                                  }
                                  className="absolute left-0 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center h-4 w-4 rounded bg-primary text-text-inverse"
                                >
                                  <Plus className="h-2.5 w-2.5" />
                                </button>
                              )}
                            </td>
                            <td className="pl-2 whitespace-pre leading-5">{line.content || ' '}</td>
                          </tr>
                          {isCommentTarget && (
                            <tr>
                              <td colSpan={3}>
                                <InlineCommentForm
                                  onCancel={() => setCommentingOn(null)}
                                  onSubmit={(body) =>
                                    addCommentMutation.mutate({
                                      body,
                                      filePath: activeChunk.file,
                                      line: currentLine,
                                    })
                                  }
                                  isPending={addCommentMutation.isPending}
                                />
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </pre>
      </div>
    </Card>
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
          <Card className="divide-y divide-border">
            {commits.map((c: CommitInfo) => (
              <div key={c.sha} className="flex items-center gap-3 px-4 py-2">
                <code className="text-xs text-text-secondary font-mono">{c.shortSha}</code>
                <span className="text-sm flex-1 truncate">{c.message}</span>
                <span className="text-xs text-text-secondary">{c.author}</span>
              </div>
            ))}
          </Card>
        </div>
      )}

      {/* File navigation + diff carousel */}
      {stats.length > 0 && (
        <Card className="overflow-hidden">
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
              <Card className="flex items-center overflow-hidden">
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
              </Card>
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
        </Card>
      )}

      {/* Active file diff */}
      {activeChunk && repoId && (
        <ActiveFileDiff
          activeChunk={activeChunk}
          activeStat={activeStat}
          diffView={diffView}
          repoId={repoId}
          prNumber={prNumber}
        />
      )}

      {!diff?.diff && stats.length === 0 && (
        <div className="text-sm text-text-secondary text-center py-8">
          No diff available for this pull request.
        </div>
      )}
    </>
  );
}
