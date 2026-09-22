import { Plus } from 'lucide-react';
import { Fragment, useMemo, useState } from 'react';

import { getFileIcon, parseDiff } from './diff-utils';
import type { FileChunk, FileStat } from './diff-utils';
import { InlineCommentForm } from './InlineCommentForm';

import { reposApi } from '@/api/repos.api';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useMutationWithToast } from '@/hooks/useMutationWithToast';
import { cn } from '@/lib/utils';

interface CommentingOn {
  filePath: string;
  line: number;
}

interface ActiveFileDiffProps {
  activeChunk: FileChunk;
  activeStat?: FileStat;
  diffView: 'unified' | 'split';
  repoId: string;
  prNumber: number;
}

function DiffFileHeader({ activeStat }: { activeStat?: FileStat }) {
  return (
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
  );
}

/**
 * @param root0
 * @param root0.activeChunk
 * @param root0.activeStat
 * @param root0.diffView
 * @param root0.repoId
 * @param root0.prNumber
 */
export function ActiveFileDiff({
  activeChunk,
  activeStat,
  diffView,
  repoId,
  prNumber,
}: ActiveFileDiffProps) {
  const [commentingOn, setCommentingOn] = useState<CommentingOn | null>(null);

  const addCommentMutation = useMutationWithToast(
    (data: { body: string; filePath: string; line: number }) =>
      reposApi.addPRComment(repoId, prNumber, data),
    {
      successMessage: 'Comment added',
      errorMessage: 'Failed to add comment',
      invalidateKeys: [['pr', repoId, prNumber]],
      onSuccess: () => setCommentingOn(null),
    },
  );

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
        <DiffFileHeader activeStat={activeStat} />
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
      <DiffFileHeader activeStat={activeStat} />
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
                                <Button
                                  variant="primary"
                                  size="xs"
                                  aria-label="Add comment"
                                  onClick={() =>
                                    setCommentingOn({
                                      filePath: activeChunk.file,
                                      line: currentLine,
                                    })
                                  }
                                  className="absolute left-0 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity !p-0 !h-4 !w-4 !min-w-0 rounded"
                                >
                                  <Plus className="h-2.5 w-2.5" />
                                </Button>
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
