// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';

import { normalizeMarkdown } from './converter';
import { mergeMarkdown } from './merge';

/**
 * Every pair of these snippets, joined by a blank line or a single newline, must
 * normalise stably and survive an identity merge (base = ours = theirs).
 */
const snippets = [
  'Para one',
  '# H1',
  '#### H4',
  '- a\n- b',
  '1. x\n2. y',
  '- [ ] t\n- [x] u',
  '> quote',
  '> [!NOTE]\n> callout',
  '```js\ncode\n```',
  '```mermaid\ngraph TD\n```',
  '---',
  '| A | B |\n| --- | --- |\n| 1 | 2 |',
  '<div>raw</div>',
  'Text with <kbd>K</kbd> inline',
  '![img](http://x/y.png)',
  '[link](http://x)',
  '**bold** _it_ ~~s~~',
  'line one\nline two',
  'a  \nhard',
  '[[toc]]',
  '- a\n\n  para in item',
  '* star item',
  '+ plus item',
];

describe('round trip and merge identity over snippet pairs', () => {
  it('is stable after one normalisation and merges to itself', () => {
    const bad: string[] = [];
    for (const a of snippets) {
      for (const b of snippets) {
        for (const sep of ['\n\n', '\n']) {
          const input = a + sep + b;
          const once = normalizeMarkdown(input);
          if (normalizeMarkdown(once) !== once) {
            bad.push(`unstable: ${JSON.stringify(input)}`);
            continue;
          }
          const merged = mergeMarkdown(once, once, once).merged;
          if (merged === null || normalizeMarkdown(merged) !== once) {
            bad.push(`merge identity: ${JSON.stringify(input)}`);
          }
        }
      }
    }
    expect(bad).toEqual([]);
  }, 60_000);
});
