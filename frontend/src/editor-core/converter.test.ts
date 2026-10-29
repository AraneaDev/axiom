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
});
