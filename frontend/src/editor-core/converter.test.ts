import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import {
  markdownToProseMirrorJSON,
  markdownToYFragment,
  normalizeMarkdown,
  proseMirrorJSONToMarkdown,
  yFragmentToMarkdown,
} from './converter';

const identical: Record<string, string> = {
  heading: '# One\n\n## Two\n\n### Three',
  marks:
    'Text with **bold**, *italic*, ~~strike~~, <u>underline</u>, `code` and a [link](https://x.test).',
  bulletList: '- a\n- b\n  - nested',
  orderedList: '1. one\n2. two',
  codeBlock: '```ts\nconst a = 1;\n```',
  mermaid: '```mermaid\ngraph TD\n  A --> B\n```',
  table: '| a | b |\n| --- | --- |\n| `x\\|y` | 2 |\n',
  taskList: '- [ ] open\n\n- [x] done',
  callout: '> [!WARNING]\n> careful',
  collapsible: '> [!DETAILS] More\n> hidden',
  issueEmbed: 'a\n\n:::issue AXM-12:::\n\nb',
  issueReference: 'See <span data-issue-key="AXM-7" class="issue-ref">AXM-7</span>.',
  mention: 'Hi <span class="mention">@Tim Schipper</span>.',
  toc: '[TOC]\n\n## Section',
  rawHtml: '<details><summary>x</summary>y</details>\n\n:::foo bar:::',
  deepHeadings: '#### Four\n\n##### Five\n\n###### Six',
  inlineHtml: 'Press <kbd>Ctrl</kbd>, H<sub>2</sub>O and <span style="color: red">red</span>.',
  codeWithMarks: '**`bold`**, *`italic`* and [`linked`](https://x.test).',
  footnote: 'Text[^1].\n\n[^1]: The note.',
  tableAtoms: '| a |\n| --- |\n| <span class="mention">@T</span> |\n',
  tableCodeBackslash: '| a |\n| --- |\n| `x\\\\|y` |\n',
  inlineImage: 'text ![s](x.png) more',
  tightListWithCode: '- step:\n  ```bash\n  npm ci\n  ```\n- done',
};

describe('editor core converter', () => {
  it.each(Object.entries(identical))('round-trips %s unchanged', (_name, md) => {
    expect(normalizeMarkdown(md)).toBe(md);
  });

  it('normalises [!IMPORTANT] to a warning callout once', () => {
    const once = normalizeMarkdown('> [!IMPORTANT]\n> x');
    expect(once).toBe('> [!WARNING]\n> x');
    expect(normalizeMarkdown(once)).toBe(once);
  });

  it('converts through ProseMirror JSON', () => {
    const json = markdownToProseMirrorJSON('# Title\n\n:::issue AXM-1:::');
    expect(json.content?.map((n) => n.type)).toEqual(['heading', 'issueEmbed']);
    expect(json.content?.[1].attrs).toEqual({ issueKey: 'AXM-1' });
    expect(proseMirrorJSONToMarkdown(json)).toBe('# Title\n\n:::issue AXM-1:::\n');
  });

  it('keeps inline HTML tags as raw text, not live HTML', () => {
    const json = markdownToProseMirrorJSON('a <kbd>b</kbd> <img src=x onerror=alert(1)>');
    const inline = json.content?.[0].content ?? [];
    const raw = inline.filter((n) => n.marks?.some((m) => m.type === 'rawHtmlInline'));
    expect(raw.map((n) => n.text)).toEqual(['<kbd>', '</kbd>']);
    expect(inline.find((n) => n.type === 'image')?.attrs).toMatchObject({ src: 'x' });
  });

  it('parses a mention span back into a mention node', () => {
    const json = markdownToProseMirrorJSON('<span class="mention">@Tim</span>');
    expect(json.content?.[0].content?.[0]).toMatchObject({
      type: 'mention',
      attrs: { label: 'Tim' },
    });
  });

  it('round-trips through a Yjs fragment', () => {
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment('default');
    const md = Object.values(identical).join('\n\n');
    markdownToYFragment(md, fragment);
    expect((fragment.get(0) as Y.XmlElement).nodeName).toBe('heading');
    expect(yFragmentToMarkdown(fragment)).toBe(normalizeMarkdown(md));
  });

  describe('tight list items with several blocks keep every block', () => {
    const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
    const tightList = (second: Record<string, unknown>) => ({
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          attrs: { tight: true },
          content: [
            { type: 'listItem', content: [p('a'), second] },
            { type: 'listItem', content: [p('b')] },
          ],
        },
      ],
    });
    const shape = (json: ReturnType<typeof markdownToProseMirrorJSON>) =>
      JSON.stringify(json, (key, value) => (key === 'tight' ? undefined : value));
    const cases: Record<string, Record<string, unknown>> = {
      horizontalRule: { type: 'horizontalRule' },
      paragraph: p('second'),
      issueEmbed: { type: 'issueEmbed', attrs: { issueKey: 'AXM-1' } },
      tableOfContents: { type: 'tableOfContents' },
      emptyBulletList: {
        type: 'bulletList',
        attrs: { tight: true },
        content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }],
      },
      emptyOrderedList: {
        type: 'orderedList',
        attrs: { tight: true, start: 1, type: null },
        content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }],
      },
      codeBlock: {
        type: 'codeBlock',
        attrs: { language: 'bash' },
        content: [{ type: 'text', text: 'npm ci' }],
      },
    };
    it.each(Object.entries(cases))('%s', (_name, second) => {
      const doc = tightList(second);
      const md = proseMirrorJSONToMarkdown(doc);
      const back = markdownToProseMirrorJSON(md);
      expect(shape(back)).toBe(shape(markdownToProseMirrorJSON(proseMirrorJSONToMarkdown(back))));
      expect(shape(back)).toBe(shape(doc as ReturnType<typeof markdownToProseMirrorJSON>));
      expect(normalizeMarkdown(md)).toBe(md);
    });
    it('keeps a code block in an item whose first paragraph is empty', () => {
      const doc = {
        type: 'doc',
        content: [
          {
            type: 'bulletList',
            attrs: { tight: true },
            content: [
              {
                type: 'listItem',
                content: [
                  { type: 'paragraph' },
                  {
                    type: 'codeBlock',
                    attrs: { language: 'bash' },
                    content: [{ type: 'text', text: 'npm ci' }],
                  },
                ],
              },
              { type: 'listItem', content: [p('b')] },
            ],
          },
        ],
      };
      const md = proseMirrorJSONToMarkdown(doc);
      expect(shape(markdownToProseMirrorJSON(md))).toBe(
        shape(doc as ReturnType<typeof markdownToProseMirrorJSON>),
      );
      expect(normalizeMarkdown(md)).toBe(md);
    });

    it('keeps a task item whose first paragraph is empty', () => {
      const doc = {
        type: 'doc',
        content: [
          {
            type: 'taskList',
            content: [
              {
                type: 'taskItem',
                attrs: { checked: true },
                content: [
                  { type: 'paragraph' },
                  {
                    type: 'codeBlock',
                    attrs: { language: 'bash' },
                    content: [{ type: 'text', text: 'npm ci' }],
                  },
                ],
              },
              { type: 'taskItem', attrs: { checked: false }, content: [p('b')] },
            ],
          },
        ],
      };
      const md = proseMirrorJSONToMarkdown(doc);
      expect(shape(markdownToProseMirrorJSON(md))).toBe(
        shape(doc as ReturnType<typeof markdownToProseMirrorJSON>),
      );
      expect(normalizeMarkdown(md)).toBe(md);
    });

    it('stays tight when the next block interrupts a paragraph', () => {
      expect(proseMirrorJSONToMarkdown(tightList(cases.codeBlock))).toBe(
        '- a\n  ```bash\n  npm ci\n  ```\n- b',
      );
    });
  });
});
