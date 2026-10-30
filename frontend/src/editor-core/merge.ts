/**
 * Block-level three-way merge for normalised wiki Markdown.
 * Pure TypeScript, no DOM or database. Inputs come from the server converter,
 * so differences are content changes, not formatting.
 */

import { diff3Merge, diffIndices } from 'node-diff3';

export type MergeHunk =
  | { kind: 'clean'; text: string }
  | { kind: 'conflict'; id: string; base: string; ours: string; theirs: string };

const ITEM_RE = /^([-*+]|\d{1,9}[.)])(\s|$)/;
const DELIM_RE = /^\|[\s:|-]+$/;
const FENCE_RE = /^\s*(`{3,}|~{3,})/;

const isItem = (b: string) => ITEM_RE.test(b);
const isRow = (b: string) => b.startsWith('|');
/**
 * Whether a block is a table's first block: its header row with the delimiter row below it.
 * @param b - A block.
 */
const isTableStart = (b: string) => isRow(b) && DELIM_RE.test(b.split('\n')[1] ?? '');

/**
 * Whether two blocks go on consecutive lines: items of one tight list, or rows of one
 * table. A block ending in "\n" is an item of a loose list. A table header after a
 * row starts another table, which needs the blank line.
 * @param prev - The text before, its last top-level line for a joined text.
 * @param prevText - The whole text before.
 * @param next - The text after.
 */
function joinsTightly(prev: string, prevText: string, next: string): boolean {
  return (
    prevText.endsWith('\n') ||
    (isItem(prev) && isItem(next)) ||
    (isRow(prev) && isRow(next) && !isTableStart(next))
  );
}

/**
 * Splits Markdown into top-level blocks. List items and table rows are their own
 * blocks (a table header and its delimiter row stay together); fenced code is one
 * block. An item followed by a blank line and another item ends with "\n", which
 * marks a loose list so the join below can restore the blank line.
 * CRLF input is normalised to LF first.
 * @param md - Markdown, ideally already normalised by the converter
 * @returns the top-level blocks
 */
export function splitBlocks(md: string): string[] {
  md = md.replace(/\r\n?/g, '\n');
  const blocks: string[] = [];
  let cur: string[] = [];
  let fence: string | null = null;
  let html = false;
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
      html = false;
      continue;
    }
    if (html) {
      // An HTML block runs to the next blank line, list markers and rows included
      cur.push(line);
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
    if (cur.length === 1 && line.startsWith('<')) html = true;
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
  return a + (joinsTightly(lastTop, a, b) ? '\n' : '\n\n') + b;
}

function joinTexts(texts: string[]): string {
  return texts.reduce((acc, t, i) => (i === 0 ? t : joinText(acc, t)), '');
}

function joinBlocks(blocks: string[]): string {
  let out = '';
  blocks.forEach((b, i) => {
    if (i > 0) {
      const prev = blocks[i - 1];
      out += joinsTightly(prev, prev, b) ? '\n' : '\n\n';
    }
    out += b;
  });
  return out;
}

/**
 * Three-way merge at block level. Inputs should be converter-normalised Markdown:
 * spacing that is not normalised is not preserved exactly. CRLF is normalised to LF.
 * A conflict whose ours, theirs and base sides have the same number of blocks is
 * split per block position, so edits to different neighbouring blocks merge cleanly.
 * @param base - common ancestor
 * @param ours - our version
 * @param theirs - their version
 * @returns merged text (null when there are conflicts) and the hunks
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
  const conflict = (o: string[], a: string[], b: string[]) =>
    hunks.push({
      kind: 'conflict',
      id: `c${n++}`,
      base: joinBlocks(o),
      ours: joinBlocks(a),
      theirs: joinBlocks(b),
    });
  for (const r of result) {
    if (r.ok) {
      if (r.ok.length) hunks.push({ kind: 'clean', text: joinBlocks(r.ok) });
    } else if (r.conflict) {
      const { a, o, b } = r.conflict;
      if (a.length === o.length && b.length === o.length && o.length > 1) {
        a.forEach((ai, i) => {
          if (ai === b[i]) hunks.push({ kind: 'clean', text: ai });
          else if (ai === o[i]) hunks.push({ kind: 'clean', text: b[i] });
          else if (b[i] === o[i]) hunks.push({ kind: 'clean', text: ai });
          else conflict([o[i]], [ai], [b[i]]);
        });
      } else {
        conflict(o, a, b);
      }
    }
  }
  if (hunks.some((h) => h.kind === 'conflict')) return { merged: null, hunks };
  return { merged: joinTexts(hunks.map((h) => (h.kind === 'clean' ? h.text : ''))), hunks };
}

function chosen(id: string, choices: Record<string, string>): string {
  if (!Object.prototype.hasOwnProperty.call(choices, id)) {
    throw new Error(`resolveMerge: no choice for conflict ${id}`);
  }
  return choices[id];
}

/**
 * Joins hunks, using the chosen text for each conflict id. An empty string drops the
 * hunk; a conflict without a choice throws.
 * @param hunks - hunks from mergeMarkdown
 * @param choices - chosen text per conflict id
 * @returns the resolved Markdown
 */
export function resolveMerge(hunks: MergeHunk[], choices: Record<string, string>): string {
  return joinTexts(
    hunks.map((h) => (h.kind === 'clean' ? h.text : chosen(h.id, choices))).filter((t) => t !== ''),
  );
}

type Region = { start: number; length: number; content: string[] };

/**
 * Changed regions of one side against the base. A same-count replacement is split per block
 * position, as mergeMarkdown splits same-count conflicts, so neighbouring edits stay apart.
 * @param base
 * @param side
 */
function regions(base: string[], side: string[]): Region[] {
  return diffIndices(base, side).flatMap((r): Region[] => {
    const [start, length] = r.buffer1;
    const content = r.buffer2Content as string[];
    if (length > 1 && content.length === length) {
      return content
        .map((block, i) => ({ start: start + i, length: 1, content: [block] }))
        .filter((region, i) => region.content[0] !== base[start + i]);
    }
    return [{ start, length, content }];
  });
}

/**
 * Whether two changes to the base touch the same blocks (two insertions at one point do too)
 * @param a
 * @param b
 */
function overlaps(a: Region, b: Region): boolean {
  if (a.length === 0 && b.length === 0) return a.start === b.start;
  if (a.length === 0) return a.start > b.start && a.start < b.start + b.length;
  if (b.length === 0) return b.start > a.start && b.start < a.start + a.length;
  return a.start < b.start + b.length && b.start < a.start + a.length;
}

function sameChange(a: Region, b: Region): boolean {
  return (
    a.start === b.start &&
    a.length === b.length &&
    a.content.length === b.content.length &&
    a.content.every((block, i) => block === b.content[i])
  );
}

/**
 * Counts for a merge notice: how many of their changes (block regions changed against the base)
 * apply without touching a change of ours, and how many conflicts the merge has.
 * @param base - common ancestor
 * @param ours - our version
 * @param theirs - their version
 * @param hunks - mergeMarkdown(base, ours, theirs).hunks
 * @returns clean change count and conflict count
 */
export function countMergeChanges(
  base: string,
  ours: string,
  theirs: string,
  hunks: MergeHunk[],
): { clean: number; conflicts: number } {
  const baseBlocks = splitBlocks(base);
  const mine = regions(baseBlocks, splitBlocks(ours));
  const clean = regions(baseBlocks, splitBlocks(theirs)).filter((t) =>
    mine.every((o) => !overlaps(o, t) || sameChange(o, t)),
  ).length;
  return { clean, conflicts: hunks.filter((h) => h.kind === 'conflict').length };
}
