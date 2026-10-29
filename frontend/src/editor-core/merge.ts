/**
 * Block-level three-way merge for normalised wiki Markdown.
 * Pure TypeScript, no DOM or database. Inputs come from the server converter,
 * so differences are content changes, not formatting.
 */

import { diff3Merge } from 'node-diff3';

export type MergeHunk =
  | { kind: 'clean'; text: string }
  | { kind: 'conflict'; id: string; base: string; ours: string; theirs: string };

const ITEM_RE = /^([-*+]|\d{1,9}[.)])(\s|$)/;
const DELIM_RE = /^\|[\s:|-]+$/;
const FENCE_RE = /^\s*(`{3,}|~{3,})/;

const isItem = (b: string) => ITEM_RE.test(b);
const isRow = (b: string) => b.startsWith('|');

/**
 * Splits Markdown into top-level blocks. List items and table rows are their own
 * blocks (a table header and its delimiter row stay together); fenced code is one
 * block. An item followed by a blank line and another item ends with "\n", which
 * marks a loose list so the join below can restore the blank line.
 * @param md
 */
export function splitBlocks(md: string): string[] {
  const blocks: string[] = [];
  let cur: string[] = [];
  let fence: string | null = null;
  let pendingBlank = false;

  const flush = () => {
    if (cur.length) blocks.push(cur.join('\n'));
    cur = [];
  };

  for (const line of md.split('\n')) {
    if (fence) {
      cur.push(line);
      const m = FENCE_RE.exec(line);
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length && line.trim() === m[1])
        fence = null;
      continue;
    }
    if (line.trim() === '') {
      pendingBlank = cur.length > 0;
      continue;
    }
    const indented = /^\s/.test(line);
    const curFirst = cur[0] ?? '';
    if (pendingBlank) {
      if (indented && isItem(curFirst)) {
        // continuation of a loose list item
        cur.push('', line);
        pendingBlank = false;
        const f = FENCE_RE.exec(line);
        if (f) fence = f[1];
        continue;
      }
      if (isItem(curFirst) && isItem(line)) cur.push('');
      flush();
      pendingBlank = false;
    } else if (cur.length) {
      const startsNew =
        (isItem(line) && !indented) ||
        (isRow(line) && !(cur.length === 1 && isRow(curFirst) && DELIM_RE.test(line)));
      if (startsNew) flush();
    }
    cur.push(line);
    const f = FENCE_RE.exec(line);
    if (f && !line.trim().slice(f[1].length).includes(f[1][0])) fence = f[1];
  }
  flush();
  return blocks;
}

/**
 * Joins two already joined texts (hunk boundaries) the way joinBlocks joins blocks.
 * @param a
 * @param b
 */
function joinText(a: string, b: string): string {
  const lastTop = [...a.split('\n')].reverse().find((l) => l.trim() !== '' && !/^\s/.test(l)) ?? '';
  const tight = a.endsWith('\n') || (isItem(lastTop) && isItem(b)) || (isRow(lastTop) && isRow(b));
  return a + (tight ? '\n' : '\n\n') + b;
}

function joinTexts(texts: string[]): string {
  return texts.reduce((acc, t, i) => (i === 0 ? t : joinText(acc, t)), '');
}

function joinBlocks(blocks: string[]): string {
  let out = '';
  blocks.forEach((b, i) => {
    if (i > 0) {
      const prev = blocks[i - 1];
      const tight = prev.endsWith('\n') || (isItem(prev) && isItem(b)) || (isRow(prev) && isRow(b));
      out += tight ? '\n' : '\n\n';
    }
    out += b;
  });
  return out;
}

/**
 *
 * @param base
 * @param ours
 * @param theirs
 */
export function mergeMarkdown(
  base: string,
  ours: string,
  theirs: string,
): { merged: string | null; hunks: MergeHunk[] } {
  const result = diff3Merge(splitBlocks(ours), splitBlocks(base), splitBlocks(theirs), {
    excludeFalseConflicts: true,
  });
  const hunks: MergeHunk[] = [];
  let n = 0;
  for (const r of result) {
    if (r.ok) {
      if (r.ok.length) hunks.push({ kind: 'clean', text: joinBlocks(r.ok) });
    } else if (r.conflict) {
      hunks.push({
        kind: 'conflict',
        id: `c${n++}`,
        base: joinBlocks(r.conflict.o),
        ours: joinBlocks(r.conflict.a),
        theirs: joinBlocks(r.conflict.b),
      });
    }
  }
  if (hunks.some((h) => h.kind === 'conflict')) return { merged: null, hunks };
  return { merged: joinTexts(hunks.map((h) => (h.kind === 'clean' ? h.text : ''))), hunks };
}

/**
 * Joins hunks, using the chosen text for each conflict id (empty text drops the hunk).
 * @param hunks
 * @param choices
 */
export function resolveMerge(hunks: MergeHunk[], choices: Record<string, string>): string {
  return joinTexts(
    hunks
      .map((h) => (h.kind === 'clean' ? h.text : (choices[h.id] ?? h.ours)))
      .filter((t) => t !== ''),
  );
}
