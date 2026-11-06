import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { LOG_TAIL_LIMITS, logTail } from './log-tail';

const FIXTURE = readFileSync(
  path.join(__dirname, '../../test/__fixtures__/github/checks/job-log.txt'),
  'utf8',
);
const ESC = '\u001b';
const stamp = (n: number) => `2026-11-06T10:00:${String(n % 60).padStart(2, '0')}.1234567Z `;

describe('logTail', () => {
  it('limits are the agreed ones', () => {
    expect(LOG_TAIL_LIMITS).toEqual({ lines: 100, bytes: 16384, downloadBytes: 1_048_576 });
  });

  it('keeps 100 lines of the 300-line fixture, ending at the error, clean of noise', () => {
    expect(FIXTURE.split(/\r?\n/).length).toBe(301); // 300 lines and the final newline
    const { text, truncated } = logTail(FIXTURE);
    const lines = text.split('\n');

    expect(truncated).toBe(true);
    expect(lines).toHaveLength(100);
    expect(lines.at(-1)).toBe('##[error]Process completed with exit code 1.');
    expect(lines.at(-3)).toMatch(/Test Files {2}1 failed/);
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z/);
    expect(text).not.toContain(ESC);
    expect(text).not.toContain('\r');
    expect(text).not.toContain('Post Run');
    expect(text).not.toContain('Post job cleanup.');
    expect(text).not.toContain('Cleaning up orphan processes');
  });

  it('returns a log under both caps whole', () => {
    const raw = ['one', 'two', 'three'].join('\n');
    expect(logTail(raw)).toEqual({ text: raw, truncated: false });
  });

  it('does not count the final newline as a line, or the dropped timestamps as a cut', () => {
    const raw = `${stamp(1)}alpha\n${stamp(2)}beta\n`;
    expect(logTail(raw)).toEqual({ text: 'alpha\nbeta', truncated: false });
  });

  it('handles CRLF line ends like LF ones', () => {
    const lf = Array.from({ length: 150 }, (_, i) => `row ${i}`);
    const a = logTail(lf.join('\n'));
    const b = logTail(lf.join('\r\n'));
    expect(b).toEqual(a);
    expect(a.text.split('\n')).toHaveLength(100);
    expect(a.text.startsWith('row 50\n')).toBe(true);
    expect(a.truncated).toBe(true);
  });

  it('keeps the last piece of a line the runner redrew with a carriage return', () => {
    expect(logTail('progress 10%\rprogress 60%\rprogress 100%\ndone').text).toBe(
      'progress 100%\ndone',
    );
  });

  it('keeps the last 100 lines of a log that has no ##[error]', () => {
    const raw = Array.from({ length: 250 }, (_, i) => `${stamp(i)}line ${i}`).join('\n');
    const { text, truncated } = logTail(raw);
    const lines = text.split('\n');
    expect(truncated).toBe(true);
    expect(lines[0]).toBe('line 150');
    expect(lines.at(-1)).toBe('line 249');
  });

  it('keeps post-job lines when the log has no error', () => {
    const { text, truncated } = logTail(
      ['work', '##[group]Post Run actions/checkout', 'Post job cleanup.'].join('\n'),
    );
    expect(text).toContain('Post job cleanup.');
    expect(truncated).toBe(false);
  });

  it('drops post-job lines only after the first ##[error], from the first Post line after it', () => {
    const raw = [
      '##[group]Post Run something-before-the-error',
      'a',
      '##[error]first',
      'b',
      '##[group]Post Run actions/checkout',
      'c',
      '##[error]second, after the post group',
    ].join('\n');
    expect(logTail(raw).text).toBe(
      ['##[group]Post Run something-before-the-error', 'a', '##[error]first', 'b'].join('\n'),
    );
    const cleanup = ['##[error]boom', 'tail', 'Post job cleanup.', 'x'].join('\n');
    expect(logTail(cleanup)).toEqual({ text: '##[error]boom\ntail', truncated: true });
  });

  it('strips ANSI colors, cursor moves and OSC titles, however the parameters look', () => {
    const raw = [
      `${ESC}[31;1mred${ESC}[0m`,
      `${ESC}[38;5;196mindexed${ESC}[39m`,
      `${ESC}[38;2;10;20;30mtruecolor${ESC}[0m`,
      `${ESC}[2K${ESC}[1Gcleared`,
      `${ESC}[?25hcursor`,
      `${ESC}]0;window title\u0007titled`,
      `${ESC}]8;;https://example.test${ESC}\\link${ESC}]8;;${ESC}\\`,
      `${ESC}(Bcharset`,
    ].join('\n');
    expect(logTail(raw).text).toBe(
      ['red', 'indexed', 'truecolor', 'cleared', 'cursor', 'titled', 'link', 'charset'].join('\n'),
    );
  });

  it('strips an escape sequence that the cut left unfinished at either end of a line', () => {
    const raw = [`before ${ESC}`, `middle ${ESC}[31`, `${ESC}[`, `${ESC}[1;3`, `end`].join('\n');
    const { text } = logTail(raw);
    expect(text).not.toContain(ESC);
    expect(text.split('\n')).toEqual(['before ', 'middle ', '', '', 'end']);
  });

  it('strips a sequence that opens before a timestamp is read', () => {
    expect(logTail(`${stamp(3)}${ESC}[32mgreen${ESC}[0m`).text).toBe('green');
    expect(logTail(`${ESC}[2m${stamp(3)}dim stamp`).text).toBe('dim stamp');
  });

  it('drops the leading byte order mark', () => {
    expect(logTail(`\uFEFF${stamp(1)}first`).text).toBe('first');
  });

  it('drops NUL characters', () => {
    expect(logTail('a\u0000b').text).toBe('ab');
  });

  it('drops first lines until the text fits 16384 bytes', () => {
    const line = 'x'.repeat(999);
    const raw = Array.from({ length: 60 }, (_, i) => `${String(i).padStart(2, '0')}${line}`).join(
      '\n',
    );
    const { text, truncated } = logTail(raw);
    expect(truncated).toBe(true);
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(LOG_TAIL_LIMITS.bytes);
    expect(text.endsWith(`59${line}`)).toBe(true);
    // Whole lines only: the first kept line is complete
    expect(text.split('\n')[0]).toHaveLength(1001);
    // And it dropped no more than it had to
    const kept = text.split('\n').length;
    expect(
      Buffer.byteLength(
        raw
          .split('\n')
          .slice(-(kept + 1))
          .join('\n'),
      ),
    ).toBeGreaterThan(LOG_TAIL_LIMITS.bytes);
  });

  it('cuts a single 20 KB line to its last 16384 bytes', () => {
    const raw = `${'a'.repeat(20_000)}END`;
    const { text, truncated } = logTail(raw);
    expect(truncated).toBe(true);
    expect(Buffer.byteLength(text)).toBe(LOG_TAIL_LIMITS.bytes);
    expect(text.endsWith('aEND')).toBe(true);
  });

  it('cuts a long line on a UTF-8 boundary, whatever the character width', () => {
    for (const unit of ['é', '€', '😀']) {
      for (const pad of ['', 'a', 'ab', 'abc']) {
        const raw = `${pad}${unit.repeat(20_000)}`;
        const { text } = logTail(raw);
        const bytes = Buffer.byteLength(text);
        expect(text).not.toContain('�');
        expect(bytes).toBeLessThanOrEqual(LOG_TAIL_LIMITS.bytes);
        // At most one character's worth of bytes was given up to stay on a boundary
        expect(bytes).toBeGreaterThan(LOG_TAIL_LIMITS.bytes - 4);
        expect(text.startsWith(unit)).toBe(true);
        expect([...text].every((c) => c === unit)).toBe(true);
      }
    }
  });

  it('does not touch multi-byte characters inside the kept lines', () => {
    const raw = Array.from({ length: 120 }, (_, i) => `rij ${i} 😀 é €`).join('\n');
    const { text } = logTail(raw);
    expect(text.split('\n')[0]).toBe('rij 20 😀 é €');
    expect(text).not.toContain('�');
  });

  it('answers an empty log with an empty text', () => {
    expect(logTail('')).toEqual({ text: '', truncated: false });
    expect(logTail('\r\n')).toEqual({ text: '', truncated: false });
  });

  it('does not let an unfinished OSC reach across lines to the next bell', () => {
    const raw = `title ${ESC}]0;never closed\nsecond line\nthird\u0007 line`;
    const { text } = logTail(raw);
    expect(text.split('\n')[1]).toBe('second line');
    expect(text.split('\n')).toHaveLength(3);
    expect(text).toContain('second line');
  });

  describe('text that could make the log read differently than it is', () => {
    it.each([
      ['BEL', '\u0007'],
      ['BS', '\u0008'],
      ['VT', '\u000B'],
      ['FF', '\u000C'],
      ['SO', '\u000E'],
      ['US', '\u001F'],
      ['DEL', '\u007F'],
    ])('strips the C0 control %s', (_name, char) => {
      expect(logTail(`a${char}b`).text).toBe('ab');
    });

    it.each([
      ['PAD', '\u0080'],
      ['NEL', '\u0085'],
      ['CSI (8-bit)', '\u009B'],
      ['OSC (8-bit)', '\u009D'],
      ['APC', '\u009F'],
    ])('strips the C1 control %s', (_name, char) => {
      expect(logTail(`a${char}b`).text).toBe('ab');
    });

    it.each([
      ['LRE', '\u202A'],
      ['RLE', '\u202B'],
      ['PDF', '\u202C'],
      ['LRO', '\u202D'],
      ['RLO', '\u202E'],
      ['LRI', '\u2066'],
      ['RLI', '\u2067'],
      ['FSI', '\u2068'],
      ['PDI', '\u2069'],
    ])('strips the bidi control %s', (_name, char) => {
      expect(logTail(`pass${char}fail`).text).toBe('passfail');
    });

    it('keeps tabs and newlines, and ordinary text beside the stripped ones', () => {
      expect(logTail('col1\tcol2\nrow\u0007 two é 日本').text).toBe('col1\tcol2\nrow two é 日本');
    });

    it('strips them from a line that is cut to the byte cap too', () => {
      const raw = `${'\u202E'.repeat(10)}${'a'.repeat(20_000)}`;
      expect(logTail(raw).text).toBe('a'.repeat(LOG_TAIL_LIMITS.bytes));
    });
  });
});
