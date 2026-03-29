import { describe, it, expect } from 'vitest';

import { parseSmartCommit, parseTimeDuration } from './smart-commits.service';

describe('parseSmartCommit', () => {
  it('extracts issue key from commit message', () => {
    const result = parseSmartCommit('AXM-42 fix login bug');
    expect(result).toEqual([{ issueKey: 'AXM-42', directives: [] }]);
  });

  it('parses #time directive', () => {
    const result = parseSmartCommit('AXM-42 #time 2h');
    expect(result).toEqual([
      {
        issueKey: 'AXM-42',
        directives: [{ type: 'time', value: '2h' }],
      },
    ]);
  });

  it('parses #time with minutes', () => {
    const result = parseSmartCommit('AXM-42 #time 1h30m');
    expect(result).toEqual([
      {
        issueKey: 'AXM-42',
        directives: [{ type: 'time', value: '1h30m' }],
      },
    ]);
  });

  it('parses #comment directive', () => {
    const result = parseSmartCommit('AXM-42 #comment Fixed the auth bug');
    expect(result).toEqual([
      {
        issueKey: 'AXM-42',
        directives: [{ type: 'comment', value: 'Fixed the auth bug' }],
      },
    ]);
  });

  it('parses #comment stops at next directive', () => {
    const result = parseSmartCommit('AXM-42 #comment Fixed it #resolve');
    expect(result).toEqual([
      {
        issueKey: 'AXM-42',
        directives: [
          { type: 'comment', value: 'Fixed it' },
          { type: 'transition', value: 'resolve' },
        ],
      },
    ]);
  });

  it('parses #resolve directive', () => {
    const result = parseSmartCommit('AXM-42 #resolve');
    expect(result).toEqual([
      {
        issueKey: 'AXM-42',
        directives: [{ type: 'transition', value: 'resolve' }],
      },
    ]);
  });

  it('parses #close directive', () => {
    const result = parseSmartCommit('AXM-42 #close');
    expect(result).toEqual([
      {
        issueKey: 'AXM-42',
        directives: [{ type: 'transition', value: 'close' }],
      },
    ]);
  });

  it('parses #reopen directive', () => {
    const result = parseSmartCommit('AXM-42 #reopen');
    expect(result).toEqual([
      {
        issueKey: 'AXM-42',
        directives: [{ type: 'transition', value: 'reopen' }],
      },
    ]);
  });

  it('parses #assign directive', () => {
    const result = parseSmartCommit('AXM-42 #assign tim');
    expect(result).toEqual([
      {
        issueKey: 'AXM-42',
        directives: [{ type: 'assign', value: 'tim' }],
      },
    ]);
  });

  it('parses #label directive', () => {
    const result = parseSmartCommit('AXM-42 #label frontend');
    expect(result).toEqual([
      {
        issueKey: 'AXM-42',
        directives: [{ type: 'label', value: 'frontend' }],
      },
    ]);
  });

  it('parses multiple directives', () => {
    const result = parseSmartCommit('AXM-42 #time 2h #comment Fixed the auth bug #resolve');
    expect(result).toEqual([
      {
        issueKey: 'AXM-42',
        directives: [
          { type: 'time', value: '2h' },
          { type: 'comment', value: 'Fixed the auth bug' },
          { type: 'transition', value: 'resolve' },
        ],
      },
    ]);
  });

  it('parses multiple issue keys', () => {
    const result = parseSmartCommit('AXM-42 AXM-43 #resolve');
    expect(result).toEqual([
      { issueKey: 'AXM-42', directives: [{ type: 'transition', value: 'resolve' }] },
      { issueKey: 'AXM-43', directives: [{ type: 'transition', value: 'resolve' }] },
    ]);
  });

  it('returns empty array for no issue keys', () => {
    const result = parseSmartCommit('just a regular commit message');
    expect(result).toEqual([]);
  });

  it('handles issue key with no directives', () => {
    const result = parseSmartCommit('fix AXM-42 login timeout');
    expect(result).toEqual([{ issueKey: 'AXM-42', directives: [] }]);
  });
});

describe('parseTimeDuration', () => {
  it('parses hours', () => {
    expect(parseTimeDuration('2h')).toBe(120);
  });

  it('parses minutes', () => {
    expect(parseTimeDuration('30m')).toBe(30);
  });

  it('parses hours and minutes', () => {
    expect(parseTimeDuration('1h30m')).toBe(90);
  });

  it('returns 0 for invalid input', () => {
    expect(parseTimeDuration('abc')).toBe(0);
  });
});
