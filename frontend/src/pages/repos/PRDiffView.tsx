import { useEffect, useMemo, useState } from 'react';

import { ActiveFileDiff } from './ActiveFileDiff';
import { CommitList } from './CommitList';
import { splitDiffByFile } from './diff-utils';
import { DiffFileNavigator } from './DiffFileNavigator';

import type { CommitInfo } from '@/api/repos.api';

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
      {commits && commits.length > 0 && <CommitList commits={commits} />}

      {/* File navigation + diff view toggle */}
      {stats.length > 0 && (
        <DiffFileNavigator
          stats={stats}
          activeFileIndex={activeFileIndex}
          onFileSelect={setActiveFileIndex}
          fileListOpen={fileListOpen}
          onFileListToggle={() => setFileListOpen(!fileListOpen)}
          diffView={diffView}
          onDiffViewChange={onDiffViewChange}
        />
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
