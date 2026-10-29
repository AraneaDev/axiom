import fs from 'fs';
import path from 'path';

import { beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import {
  loadEditorCore,
  markdownToYFragment,
  normalizeMarkdown,
  yFragmentToMarkdown,
} from './editor-core';

const fixtureDir = path.join(__dirname, '__fixtures__', 'markdown');
const fixtures = fs
  .readdirSync(fixtureDir)
  .filter((f) => f.endsWith('.md'))
  .sort();

function read(name: string): string {
  return fs.readFileSync(path.join(fixtureDir, name), 'utf-8');
}

/**
 * Fixtures the serializer cannot reproduce byte for byte. They must still be
 * stable after one normalisation.
 * - callout-important: `[!IMPORTANT]` parses to a warning callout, written back as `[!WARNING]`.
 * - seed-*: the seeded wiki pages (docs/*.md from seed-demo, and the seed-voorbeeld pages)
 *   are hand-written Markdown; tiptap-markdown
 *   rewrites formatting choices such as table delimiter rows, ordered list padding and
 *   `_emphasis_`, and drops headings below level 3 and bold around code.
 * @param name - Fixture file name.
 */
function normalisesOnce(name: string): boolean {
  return name === 'callout-important.md' || name.startsWith('seed-');
}

function toYjsAndBack(md: string): string {
  const doc = new Y.Doc();
  const fragment = doc.getXmlFragment('default');
  markdownToYFragment(md, fragment);
  return yFragmentToMarkdown(fragment);
}

beforeAll(async () => {
  await loadEditorCore();
});

describe('editor core markdown round trip', () => {
  it('has a fixture per block type plus the mixed, raw HTML and seeded pages', () => {
    for (const name of [
      'heading.md',
      'paragraph.md',
      'bullet-list.md',
      'ordered-list.md',
      'blockquote.md',
      'code-block.md',
      'mermaid.md',
      'horizontal-rule.md',
      'image.md',
      'hard-break.md',
      'table.md',
      'task-list.md',
      'callout.md',
      'callout-important.md',
      'collapsible.md',
      'issue-embed.md',
      'issue-reference.md',
      'mention.md',
      'smart-link.md',
      'table-of-contents.md',
      'mixed.md',
      'raw-html.md',
    ]) {
      expect(fixtures).toContain(name);
    }
    const seeded = fs
      .readdirSync(path.join(__dirname, '..', '..', 'docs'))
      .filter((f) => f.endsWith('.md'));
    for (const name of seeded) expect(fixtures).toContain(`seed-${name}`);
  });

  it.each(fixtures)('round-trips %s', (name) => {
    const md = read(name);
    const once = normalizeMarkdown(md);
    expect(normalizeMarkdown(once)).toBe(once);
    if (!normalisesOnce(name)) expect(once).toBe(md);
  });

  it.each(fixtures)('Yjs round trip equals markdown round trip for %s', (name) => {
    const md = read(name);
    expect(toYjsAndBack(md)).toBe(normalizeMarkdown(md));
  });

  it.each(fixtures)('never emits Yjs XML for %s', (name) => {
    const md = read(name);
    expect(normalizeMarkdown(md)).not.toContain('<paragraph');
    expect(toYjsAndBack(md)).not.toContain('<paragraph');
  });

  it('raw HTML and unknown blocks pass through', () => {
    const md = read('raw-html.md');
    expect(md).toContain('<details><summary>x</summary>y</details>');
    expect(md).toContain(':::foo bar:::');
    const out = toYjsAndBack(md);
    expect(out).toContain('<details><summary>x</summary>y</details>');
    expect(out).toContain(':::foo bar:::');
  });

  it('parses structure, not text', () => {
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment('default');
    markdownToYFragment('# Title\n\n- a\n- b', fragment);
    const first = fragment.get(0);
    const second = fragment.get(1);
    expect(first).toBeInstanceOf(Y.XmlElement);
    expect((first as Y.XmlElement).nodeName).toBe('heading');
    expect(second).toBeInstanceOf(Y.XmlElement);
    expect((second as Y.XmlElement).nodeName).toBe('bulletList');
  });

  it('replaces existing fragment content', () => {
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment('default');
    markdownToYFragment('# Old\n\nold text', fragment);
    markdownToYFragment('New text', fragment);
    expect(yFragmentToMarkdown(fragment)).toBe('New text');
  });
});
