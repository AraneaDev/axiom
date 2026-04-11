import { FileEdit, FileMinus, FilePlus } from 'lucide-react';
import { createElement } from 'react';

export interface DiffHunkLine {
  type: 'add' | 'del' | 'ctx';
  content: string;
}

export interface DiffHunk {
  header: string;
  lines: DiffHunkLine[];
}

export interface ParsedDiffFile {
  header: string;
  oldFile: string;
  newFile: string;
  hunks: DiffHunk[];
}

export interface FileStat {
  file: string;
  additions: number;
  deletions: number;
}

export interface FileChunk {
  file: string;
  rawDiff: string;
}

/**
 *
 * @param raw
 */
export function parseDiff(raw: string): ParsedDiffFile[] {
  const files: ParsedDiffFile[] = [];

  const fileSections = raw.split(/^diff --git /m).filter(Boolean);

  for (const section of fileSections) {
    const lines = section.split('\n');
    const header = 'diff --git ' + lines[0];

    let oldFile = '';
    let newFile = '';
    const hunks: DiffHunk[] = [];

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
 * @param rawDiff
 */
export function splitDiffByFile(rawDiff: string): FileChunk[] {
  const chunks = rawDiff.split(/(?=^diff --git )/m);
  return chunks.filter(Boolean).map((chunk) => {
    const headerMatch = chunk.match(/^diff --git a\/(.+?) b\//);
    return { file: headerMatch?.[1] ?? 'unknown', rawDiff: chunk };
  });
}

/**
 *
 * @param s
 * @param s.additions
 * @param s.deletions
 */
export function getFileIcon(s: { additions: number; deletions: number }) {
  if (s.additions > 0 && s.deletions > 0)
    return createElement(FileEdit, { className: 'h-3.5 w-3.5 text-warning shrink-0' });
  if (s.additions > 0)
    return createElement(FilePlus, { className: 'h-3.5 w-3.5 text-success shrink-0' });
  return createElement(FileMinus, { className: 'h-3.5 w-3.5 text-danger shrink-0' });
}

/**
 *
 * @param s
 * @param s.additions
 * @param s.deletions
 */
export function getChangeType(s: { additions: number; deletions: number }) {
  if (s.additions > 0 && s.deletions > 0) return 'Modified';
  if (s.additions > 0 && s.deletions === 0) return 'Added';
  if (s.deletions > 0 && s.additions === 0) return 'Deleted';
  return 'Modified';
}
