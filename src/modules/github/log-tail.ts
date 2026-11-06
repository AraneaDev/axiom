/** What is kept of a job log: the end of it, which is where the failure is */
export const LOG_TAIL_LIMITS = { lines: 100, bytes: 16384, downloadBytes: 1_048_576 } as const;

const ESC = '\u001b';
// Complete sequences: OSC (ended by BEL or ESC \), CSI, a charset choice, and any other two-byte escape
const OSC = new RegExp(`${ESC}\\][^\\u0007${ESC}]*(?:\\u0007|${ESC}\\\\)`, 'g');
const CSI = new RegExp(`${ESC}\\[[0-9:;<=>?]*[ -/]*[@-~]`, 'g');
const CHARSET = new RegExp(`${ESC}[()*+][0-9A-Za-z]`, 'g');
const TWO_BYTE = new RegExp(`${ESC}[@-Z\\\\^_0-9=>]`, 'g');
// What a cut left of one at the end of a line, and any escape that is still around
const UNFINISHED = new RegExp(`${ESC}(?:[\\[\\]][^\\n]*)?$`);
const LONE_ESCAPE = new RegExp(ESC, 'g');
// GitHub puts the time on every line: 2026-11-06T10:00:00.1234567Z
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z /;

const isPostLine = (line: string) =>
  line.startsWith('##[group]Post ') || line === 'Post job cleanup.';

/**
 * The last piece of a line a terminal would have shown after its carriage returns.
 * @param line One line
 */
function afterCarriageReturns(line: string): string {
  if (!line.includes('\r')) return line;
  const pieces = line.split('\r').filter((piece) => piece !== '');
  return pieces.at(-1) ?? '';
}

/**
 * The last `maxBytes` of a line, starting on a UTF-8 character.
 * @param line One line
 * @param maxBytes The most bytes to keep
 */
function lastBytes(line: string, maxBytes: number): string {
  const bytes = Buffer.from(line, 'utf8');
  let start = Math.max(0, bytes.length - maxBytes);
  // A continuation byte (10xxxxxx) at the cut means the character began before it
  while (start < bytes.length && (bytes[start] & 0xc0) === 0x80) start++;
  return bytes.subarray(start).toString('utf8');
}

/**
 * The end of a job log, for a person or an agent who wants to know why it failed. Strips ANSI
 * escape sequences, GitHub's per-line timestamp and carriage-return redraws. A log with a
 * `##[error]` line loses the post-job steps that follow the first one, which only repeat
 * cleanup. Then the last 100 lines are kept, and of those the last 16384 bytes, cut at a line
 * (or, for a single line, at a UTF-8 character).
 * @param raw The log as GitHub serves it
 * @returns The tail, and whether anything beyond the clean-up was dropped
 */
export function logTail(raw: string): { text: string; truncated: boolean } {
  const plain = raw
    .replaceAll('\u0000', '')
    .replace(/^\uFEFF/, '')
    .replace(OSC, '')
    .replace(CSI, '')
    .replace(CHARSET, '')
    .replace(TWO_BYTE, '');
  let lines = plain.split('\n').map((line) => {
    const unfinished = line.replace(/\r$/, '').replace(UNFINISHED, '');
    return afterCarriageReturns(unfinished).replace(LONE_ESCAPE, '').replace(TIMESTAMP, '');
  });
  if (lines.at(-1) === '') lines.pop();
  let truncated = false;

  const error = lines.findIndex((line) => line.startsWith('##[error]'));
  if (error >= 0) {
    const post = lines.findIndex((line, at) => at > error && isPostLine(line));
    if (post >= 0) {
      lines = lines.slice(0, post);
      truncated = true;
    }
  }

  if (lines.length > LOG_TAIL_LIMITS.lines) {
    lines = lines.slice(-LOG_TAIL_LIMITS.lines);
    truncated = true;
  }

  let size = lines.reduce((sum, line) => sum + Buffer.byteLength(line) + 1, -1);
  let first = 0;
  while (size > LOG_TAIL_LIMITS.bytes && first < lines.length - 1) {
    size -= Buffer.byteLength(lines[first]) + 1;
    first++;
    truncated = true;
  }
  lines = lines.slice(first);

  if (lines.length === 1 && Buffer.byteLength(lines[0]) > LOG_TAIL_LIMITS.bytes) {
    lines = [lastBytes(lines[0], LOG_TAIL_LIMITS.bytes)];
    truncated = true;
  }
  return { text: lines.join('\n'), truncated };
}
