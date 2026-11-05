import { describe, it, expect } from 'vitest';

import { normalizeMarkdown } from './converter';
import { countMergeChanges, mergeMarkdown, resolveMerge, splitBlocks } from './merge';

describe('mergeMarkdown', () => {
  describe('a live block', () => {
    const BLOCK = ':::query inline:"title ~ \\"a_b\\" AND x:::":::';
    const base = normalizeMarkdown(`one\n\n${BLOCK}\n\nthree`);

    it('stays one block of its own, the way the editor writes it', () => {
      expect(splitBlocks(base)).toEqual(['one', BLOCK, 'three']);
    });

    it('survives changes on both sides of it', () => {
      const ours = normalizeMarkdown(`ONE\n\n${BLOCK}\n\nthree`);
      const theirs = normalizeMarkdown(`one\n\n${BLOCK}\n\nTHREE`);
      expect(mergeMarkdown(base, ours, theirs).merged).toBe(`ONE\n\n${BLOCK}\n\nTHREE`);
    });

    it('takes the one side that changed its target', () => {
      const other = ':::query dashboard:cm1dash45:::';
      const theirs = normalizeMarkdown(`one\n\n${other}\n\nthree`);
      expect(mergeMarkdown(base, base, theirs).merged).toBe(`one\n\n${other}\n\nthree`);
    });

    it('is one conflict when both sides change its target differently', () => {
      const conflicts = mergeMarkdown(
        base,
        'one\n\n:::query dashboard:ours:::\n\nthree',
        'one\n\n:::query dashboard:theirs:::\n\nthree',
      ).hunks.filter((hunk) => hunk.kind === 'conflict');
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0]).toMatchObject({
        base: BLOCK,
        ours: ':::query dashboard:ours:::',
        theirs: ':::query dashboard:theirs:::',
      });
    });
  });

  it('clean merge combines changes in different blocks', () => {
    const base = 'one\n\ntwo\n\nthree';
    const r = mergeMarkdown(base, 'ONE\n\ntwo\n\nthree', 'one\n\ntwo\n\nTHREE');
    expect(r.merged).toBe('ONE\n\ntwo\n\nTHREE');
    expect(r.hunks.every((h) => h.kind === 'clean')).toBe(true);
  });

  it('same block changed differently is one conflict', () => {
    const r = mergeMarkdown('one\n\ntwo', 'one\n\nours', 'one\n\ntheirs');
    expect(r.merged).toBeNull();
    const conflicts = r.hunks.filter((h) => h.kind === 'conflict');
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ base: 'two', ours: 'ours', theirs: 'theirs' });
  });

  it('two conflicts get distinct ids', () => {
    const r = mergeMarkdown('a\n\nkeep\n\nb', 'A1\n\nkeep\n\nB1', 'A2\n\nkeep\n\nB2');
    const ids = r.hunks.flatMap((h) => (h.kind === 'conflict' ? [h.id] : []));
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it('changes to different items of one list merge cleanly', () => {
    const base = '- a\n- b\n- c';
    expect(mergeMarkdown(base, '- A\n- b\n- c', '- a\n- b\n- C').merged).toBe('- A\n- b\n- C');
  });

  it('changes to different rows of one table merge cleanly', () => {
    const base = '| h | v |\n| --- | --- |\n| a | 1 |\n| b | 2 |\n| c | 3 |';
    const ours = '| h | v |\n| --- | --- |\n| a | 10 |\n| b | 2 |\n| c | 3 |';
    const theirs = '| h | v |\n| --- | --- |\n| a | 1 |\n| b | 2 |\n| c | 30 |';
    expect(mergeMarkdown(base, ours, theirs).merged).toBe(
      '| h | v |\n| --- | --- |\n| a | 10 |\n| b | 2 |\n| c | 30 |',
    );
  });

  it('identical change on both sides is clean', () => {
    const r = mergeMarkdown('one\n\ntwo', 'one\n\nsame', 'one\n\nsame');
    expect(r.merged).toBe('one\n\nsame');
  });

  it('empty base with both sides adding text yields one conflict', () => {
    const r = mergeMarkdown('', 'ours', 'theirs');
    expect(r.merged).toBeNull();
    expect(r.hunks.filter((h) => h.kind === 'conflict')).toHaveLength(1);
  });

  it('resolveMerge applies choices in order', () => {
    const r = mergeMarkdown('a\n\nkeep\n\nb', 'A1\n\nkeep\n\nB1', 'A2\n\nkeep\n\nB2');
    const [c1, c2] = r.hunks.flatMap((h) => (h.kind === 'conflict' ? [h] : []));
    expect(resolveMerge(r.hunks, { [c1.id]: c1.theirs, [c2.id]: c2.ours })).toBe(
      'A2\n\nkeep\n\nB1',
    );
  });

  it('code fence with blank lines is one block', () => {
    const md = 'before\n\n```ts\nconst a = 1;\n\n\nconst b = 2;\n```\n\nafter';
    expect(splitBlocks(md)).toEqual([
      'before',
      '```ts\nconst a = 1;\n\n\nconst b = 2;\n```',
      'after',
    ]);
  });
});

describe('splitBlocks', () => {
  it('keeps loose list items and nested content together and round trips', () => {
    const md = '- a\n\n  second paragraph\n\n- c';
    expect(splitBlocks(md)).toHaveLength(2);
    expect(mergeMarkdown(md, md, md).merged).toBe(md);
  });

  it('keeps nested lists and callouts inside their block', () => {
    const md = '- a\n  - nested\n- b\n\n> [!NOTE]\n> hi\n\n> [!DETAILS] T\n> x';
    expect(splitBlocks(md)).toEqual([
      '- a\n  - nested',
      '- b',
      '> [!NOTE]\n> hi',
      '> [!DETAILS] T\n> x',
    ]);
    expect(mergeMarkdown(md, md, md).merged).toBe(md);
  });

  it('round trips mixed structures', () => {
    const md = '# T\n\n1. a\n2. b\n\n| h | v |\n| --- | --- |\n| a | 1 |\n\n---\n\ntext';
    expect(mergeMarkdown(md, md, md).merged).toBe(md);
  });
});

describe('merge input handling and per-block conflicts', () => {
  it('normalises CRLF input', () => {
    const r = mergeMarkdown('a\r\n\r\nb', 'a\n\nB', 'A\r\n\r\nb');
    expect(r.merged).toBe('A\n\nB');
    expect(splitBlocks('a\r\n\r\nb')).toEqual(['a', 'b']);
  });

  it('adjacent list items edited on each side merge cleanly', () => {
    expect(mergeMarkdown('- a\n- b\n- c', '- a\n- B\n- c', '- a\n- b\n- C').merged).toBe(
      '- a\n- B\n- C',
    );
  });

  it('adjacent table rows edited on each side merge cleanly', () => {
    const t = (x: string, y: string) => `| h | v |\n| --- | --- |\n| a | ${x} |\n| b | ${y} |`;
    expect(mergeMarkdown(t('1', '2'), t('10', '2'), t('1', '20')).merged).toBe(t('10', '20'));
  });

  it('same block edited on both sides in a same-count conflict stays a conflict', () => {
    const r = mergeMarkdown('- a\n- b\n- c', '- a\n- B1\n- C', '- a\n- B2\n- c');
    expect(r.merged).toBeNull();
    const cs = r.hunks.filter((h) => h.kind === 'conflict');
    expect(cs).toHaveLength(1);
    expect(cs[0]).toMatchObject({ ours: '- B1', theirs: '- B2' });
  });

  it('resolveMerge throws on a conflict without a choice and allows an empty choice', () => {
    const r = mergeMarkdown('x', 'y', 'z');
    const c = r.hunks.find((h) => h.kind === 'conflict');
    expect(() => resolveMerge(r.hunks, {})).toThrow();
    expect(resolveMerge(r.hunks, { [(c as { id: string }).id]: '' })).toBe('');
  });
});

describe('countMergeChanges', () => {
  it('counts their changes that merge cleanly and the conflicts', () => {
    const base = 'one\n\ntwo\n\nthree\n\nfour';
    const ours = 'one\n\nOURS\n\nthree\n\nfour';
    const theirs = 'ONE\n\nTHEIRS\n\nthree\n\nFOUR';
    const { hunks } = mergeMarkdown(base, ours, theirs);
    expect(countMergeChanges(base, ours, theirs, hunks)).toEqual({ clean: 2, conflicts: 1 });
  });

  it('a change both sides made identically counts as clean', () => {
    const base = 'one\n\ntwo';
    const same = 'one\n\nTWO';
    const { hunks } = mergeMarkdown(base, same, same);
    expect(countMergeChanges(base, same, same, hunks)).toEqual({ clean: 1, conflicts: 0 });
  });

  it('nothing changed on their side counts nothing', () => {
    const base = 'one\n\ntwo';
    const { hunks } = mergeMarkdown(base, 'one\n\nmine', base);
    expect(countMergeChanges(base, 'one\n\nmine', base, hunks)).toEqual({ clean: 0, conflicts: 0 });
  });
});

describe('block boundaries', () => {
  const twoTables = '| A | B |\n| --- | --- |\n| 1 | 2 |\n\n| C | D |\n| --- | --- |\n| 3 | 4 |';

  it('keeps two adjacent tables apart in an identity merge', () => {
    expect(mergeMarkdown(twoTables, twoTables, twoTables).merged).toBe(twoTables);
  });

  it('merges a table the agent added right under an existing table', () => {
    const base = 'Intro\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\nOutro';
    const theirs = base.replace('Outro', '| C | D |\n| --- | --- |\n| 3 | 4 |\n\nOutro');
    const ours = base.replace('Intro', 'Intro, edited');
    expect(mergeMarkdown(base, ours, theirs).merged).toBe(theirs.replace('Intro', 'Intro, edited'));
  });

  it('treats an HTML block as one block up to the next blank line', () => {
    const md = '<div>raw</div>\n- a\n- b\n\ntext';
    expect(splitBlocks(md)).toEqual(['<div>raw</div>\n- a\n- b', 'text']);
    expect(mergeMarkdown(md, md, md).merged).toBe(md);
  });
});
