import fs from 'fs';
import path from 'path';

import { beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import {
  loadEditorCore,
  markdownToYFragment,
  normalizeMarkdown,
  parseQueryEmbedTarget,
  queryEmbedsIn,
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
 *   are hand-written Markdown; tiptap-markdown rewrites formatting choices such as table
 *   delimiter rows, ordered list padding, `_emphasis_`, `*` bullets and `>` as `&gt;`.
 *   The document itself does not change (see 'normalisation keeps the document').
 * - soft-break-*: a soft line break is written as a space, the editor's normal form
 *   (see SOFT_BREAKS for the exact output).
 * @param name - Fixture file name.
 */
const SOFT_BREAKS: Record<string, string> = {
  'soft-break-mark.md': 'a *x* b and **y** c and `z` d',
  'soft-break-raw-html.md': 'a <kbd>x</kbd> b',
  'soft-break-footnote.md': 'a [^1] b\n\n[^1]: note',
};

function normalisesOnce(name: string): boolean {
  return name === 'callout-important.md' || name.startsWith('seed-') || name in SOFT_BREAKS;
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
      'query-embed.md',
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
    const twice = normalizeMarkdown(once);
    expect(twice).toBe(once);
    expect(normalizeMarkdown(twice)).toBe(once);
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

  it.each(fixtures)('normalisation keeps the document for %s', (name) => {
    const md = read(name);
    const fragmentJSON = (source: string) => {
      const doc = new Y.Doc();
      const fragment = doc.getXmlFragment('default');
      markdownToYFragment(source, fragment);
      return fragment.toJSON();
    };
    expect(fragmentJSON(normalizeMarkdown(md))).toBe(fragmentJSON(md));
  });

  it.each(Object.entries(SOFT_BREAKS))('keeps the soft break in %s as a space', (name, out) => {
    expect(normalizeMarkdown(read(name))).toBe(out);
  });

  it('raw HTML and unknown blocks pass through', () => {
    const md = read('raw-html.md');
    expect(md).toContain('<details><summary>x</summary>y</details>');
    expect(md).toContain(':::foo bar:::');
    const out = toYjsAndBack(md);
    expect(out).toContain('<details><summary>x</summary>y</details>');
    expect(out).toContain(':::foo bar:::');
  });

  it('knows the query embeds of a body, and none in a code block', () => {
    const embeds = queryEmbedsIn(read('query-embed.md'));
    expect(embeds).toEqual(['cm1saved23', 'dashboard:cm1dash45', 'inline:"type = Bug"']);
    expect(embeds.map(parseQueryEmbedTarget)).toEqual([
      { kind: 'savedQuery', id: 'cm1saved23' },
      { kind: 'dashboard', id: 'cm1dash45' },
      { kind: 'inline', query: 'type = Bug' },
    ]);
    expect(queryEmbedsIn('```\n:::query cm1saved23:::\n```')).toEqual([]);
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

describe('editor core DOM scope', () => {
  it('leaves no global window or document behind outside a conversion', async () => {
    await loadEditorCore();
    const g = globalThis as Record<string, unknown>;
    expect(typeof g.window).toBe('undefined');
    expect(typeof g.document).toBe('undefined');

    expect(normalizeMarkdown('# Title\n\n- a\n- [ ] t')).toBe('# Title\n\n- a\n\n- [ ] t');
    const doc = new Y.Doc();
    markdownToYFragment('Some **text**', doc.getXmlFragment('default'));
    expect(yFragmentToMarkdown(doc.getXmlFragment('default'))).toBe('Some **text**');

    expect(typeof g.window).toBe('undefined');
    expect(typeof g.document).toBe('undefined');
    expect(typeof g.DOMParser).toBe('undefined');
  });
});
