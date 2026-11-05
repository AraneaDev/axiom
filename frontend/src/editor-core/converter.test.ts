import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import {
  markdownToProseMirrorJSON,
  markdownToYFragment,
  normalizeMarkdown,
  parseQueryEmbedTarget,
  proseMirrorJSONToMarkdown,
  queryEmbedsIn,
  yFragmentToMarkdown,
} from './converter';
import { dashboardEmbedTarget, queryEmbedTarget } from './nodes/query-embed';

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
  queryEmbedSaved: 'a\n\n:::query cm1saved23:::\n\nb',
  queryEmbedDashboard: ':::query dashboard:cm1dash45:::',
  queryEmbedInline: ':::query inline:"type = Bug AND priority > Medium":::',
  queryEmbedTricky:
    ':::query inline:"title ~ \\"a_b_c_d\\" AND title ~ \\"*x*\\" AND title ~ \\"<b>:::\\" AND `y` @tim":::',
  queryEmbedInList: '- a\n\n  :::query dashboard:cm1dash45:::\n\n- b',
  queryEmbedInCallout: '> [!NOTE]\n> intro\n>\n> :::query dashboard:cm1dash45:::',
  queryNotAnEmbed: ':::query two words:::\n\n:::query inline:"not json:::\n\n:::query :::',
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
  attachmentImage:
    'See ![a chart](/api/attachments/cm1abc23) here.\n\n![](/api/attachments/cm1abc24)',
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
      queryEmbed: { type: 'queryEmbed', attrs: { target: 'dashboard:cm1dash45' } },
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

    it('keeps a task item whose empty first paragraph is followed by a nested list', () => {
      const doc = {
        type: 'doc',
        content: [
          {
            type: 'taskList',
            content: [
              {
                type: 'taskItem',
                attrs: { checked: false },
                content: [
                  { type: 'paragraph' },
                  {
                    type: 'bulletList',
                    attrs: { tight: true },
                    content: [{ type: 'listItem', content: [p('sub')] }],
                  },
                ],
              },
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

    const typesOf = (md: string) => {
      const list = markdownToProseMirrorJSON(md).content?.[0];
      return {
        list: list?.type,
        item: list?.content?.[0].type,
        first: list?.content?.[0].content?.[0],
      };
    };

    it('keeps an escaped literal box before a nested list as text', () => {
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
                  p('[x]'),
                  {
                    type: 'bulletList',
                    attrs: { tight: true },
                    content: [{ type: 'listItem', content: [p('sub')] }],
                  },
                ],
              },
            ],
          },
        ],
      };
      const md = proseMirrorJSONToMarkdown(doc);
      expect(md).toBe('- \\[x\\]\n  - sub');
      expect(shape(markdownToProseMirrorJSON(md))).toBe(
        shape(doc as ReturnType<typeof markdownToProseMirrorJSON>),
      );
      expect(normalizeMarkdown(md)).toBe(md);
    });

    it('reads a box with no space after it before a nested list as a plain bullet', () => {
      expect(typesOf('- [ ]\n  - sub')).toEqual({
        list: 'bulletList',
        item: 'listItem',
        first: p('[ ]'),
      });
    });

    it('never turns an ordered item into a task item', () => {
      for (const md of ['1. [ ]\n   ```\n   c\n   ```', '1. [ ] \n   ```\n   c\n   ```']) {
        expect(typesOf(md)).toEqual({ list: 'orderedList', item: 'listItem', first: p('[ ]') });
        expect(normalizeMarkdown(md)).toBe('1. \\[ \\]\n   ```\n   c\n   ```');
      }
    });

    it('stays tight when the next block interrupts a paragraph', () => {
      expect(proseMirrorJSONToMarkdown(tightList(cases.codeBlock))).toBe(
        '- a\n  ```bash\n  npm ci\n  ```\n- b',
      );
    });
  });
});

describe('mixed and adjacent lists', () => {
  const stable = (md: string) => {
    const once = normalizeMarkdown(md);
    expect(normalizeMarkdown(once)).toBe(once);
    return once;
  };
  const listTypes = (md: string) =>
    (markdownToProseMirrorJSON(md).content ?? []).map((n) => `${n.type}:${n.content?.length}`);

  it.each([
    ['bullet then task, tight', '- a\n- [ ] t', '- a\n\n- [ ] t', ['bulletList:1', 'taskList:1']],
    ['bullet then task, loose', '- a\n\n- [ ] t', '- a\n\n- [ ] t', ['bulletList:1', 'taskList:1']],
    ['task then bullet, tight', '- [ ] t\n- a', '- [ ] t\n\n- a', ['taskList:1', 'bulletList:1']],
    ['task then bullet, loose', '- [ ] t\n\n- a', '- [ ] t\n\n- a', ['taskList:1', 'bulletList:1']],
    [
      'two bullets then two tasks',
      '- First\n- Second\n\n- [ ] Open task\n- [x] Done\n',
      '- First\n- Second\n\n- [ ] Open task\n\n- [x] Done',
      ['bulletList:2', 'taskList:2'],
    ],
    [
      'bullet, task, bullet',
      '- a\n- [ ] t\n- b',
      '- a\n\n- [ ] t\n\n- b',
      ['bulletList:1', 'taskList:1', 'bulletList:1'],
    ],
  ])('splits a mixed list (%s) into runs without adding items', (_name, md, expected, types) => {
    expect(listTypes(md)).toEqual(types);
    expect(stable(md)).toBe(expected);
    expect(listTypes(normalizeMarkdown(normalizeMarkdown(md)))).toEqual(types);
  });

  it('keeps the editor-made bullet list followed by a task list', () => {
    const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
    const md = proseMirrorJSONToMarkdown({
      type: 'doc',
      content: [
        { type: 'bulletList', content: [{ type: 'listItem', content: [p('a')] }] },
        {
          type: 'taskList',
          content: [{ type: 'taskItem', attrs: { checked: false }, content: [p('t')] }],
        },
      ],
    });
    expect(md).toBe('- a\n\n- [ ] t');
    expect(stable(md)).toBe(md);
  });

  it('splits a mixed list inside a callout', () => {
    expect(stable('> [!NOTE]\n> - a\n> - [ ] t')).toBe('> [!NOTE]\n> - a\n>\n> - [ ] t');
  });

  it.each([
    ['- a\n\n* b', '- a\n\n* b'],
    ['* star\n- a\n- b', '- star\n\n* a\n* b'],
    ['+ plus\n\n* star', '- plus\n\n* star'],
    ['1. a\n\n1) b', '1. a\n\n1) b'],
  ])('keeps adjacent lists with different markers apart: %j', (md, expected) => {
    expect(stable(md)).toBe(expected);
  });

  it('writes a hard break in a heading as a space', () => {
    expect(stable('a  \nhard\n---')).toBe('## a hard');
  });
});

describe('query embeds', () => {
  const embedOf = (md: string) => markdownToProseMirrorJSON(md).content?.[0];

  it.each([
    ['a saved query', 'cm1saved23', { kind: 'savedQuery', id: 'cm1saved23' }],
    ['a dashboard', 'dashboard:cm1dash45', { kind: 'dashboard', id: 'cm1dash45' }],
    ['an inline query', 'inline:"type = Bug"', { kind: 'inline', query: 'type = Bug' }],
  ])('reads %s as a block', (_name, target, parsed) => {
    const embed = embedOf(`:::query ${target}:::`);
    expect(embed?.type).toBe('queryEmbed');
    expect(embed?.attrs).toEqual({ target });
    expect(parseQueryEmbedTarget(target)).toEqual(parsed);
  });

  it('keeps Markdown characters and quotes of an inline query as written', () => {
    const query = 'title ~ "a_b_c" AND title ~ "*x*" AND title ~ "<b> ::: \\\\ `y`"';
    const target = `inline:${JSON.stringify(query)}`;
    const md = `:::query ${target}:::`;
    expect(embedOf(md)?.attrs).toEqual({ target });
    expect(parseQueryEmbedTarget(target)).toEqual({ kind: 'inline', query });
    expect(normalizeMarkdown(md)).toBe(md);
  });

  it('survives the Yjs round trip', () => {
    const md = 'a\n\n:::query inline:"title ~ \\"x_y_z\\"":::\n';
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment('default');
    markdownToYFragment(md, fragment);
    expect(yFragmentToMarkdown(fragment)).toBe(normalizeMarkdown(md));
  });

  it('does not end a paragraph, and text that becomes one line stays text', () => {
    expect(queryEmbedsIn('text\n:::query cm1saved23:::')).toEqual([]);
    expect(normalizeMarkdown('text\n:::query cm1saved23:::')).toBe('text :::query cm1saved23:::');
  });

  it('settles on one space, so that text never turns into a block on a later save', () => {
    expect(queryEmbedsIn(':::query  cm1saved23:::')).toEqual(['cm1saved23']);
    expect(normalizeMarkdown(':::query  cm1saved23:::')).toBe(':::query cm1saved23:::');
  });

  it('writes what the editor holds', () => {
    const doc = {
      type: 'doc',
      content: [{ type: 'queryEmbed', attrs: { target: 'dashboard:cm1dash45' } }],
    };
    expect(proseMirrorJSONToMarkdown(doc)).toBe(':::query dashboard:cm1dash45:::');
  });

  it.each([
    ['after text in a paragraph', 'text :::query cm1saved23:::'],
    ['two words', ':::query two words:::'],
    ['bad JSON', ':::query inline:"oops:::'],
    ['JSON that is no string', ':::query inline:12:::'],
    ['an unknown prefix', ':::query other:cm1:::'],
    ['an id too long', `:::query ${'x'.repeat(65)}:::`],
  ])('leaves text alone: %s', (_name, md) => {
    expect(queryEmbedsIn(md)).toEqual([]);
    expect(normalizeMarkdown(md).trim()).toBe(md);
  });

  it('makes a target from what someone typed', () => {
    expect(dashboardEmbedTarget(' cm1dash45 ')).toBe('dashboard:cm1dash45');
    expect(dashboardEmbedTarget('http://x.test/dashboards/cm1dash45/edit?a=1')).toBe(
      'dashboard:cm1dash45',
    );
    expect(dashboardEmbedTarget('two words')).toBeNull();
    const savedId = 'cmaaaaaaaaaaaaaaaaaaaaaaa';
    expect(queryEmbedTarget(savedId)).toBe(savedId);
    expect(queryEmbedTarget('type = "Bug"')).toBe('inline:"type = \\"Bug\\""');
    expect(queryEmbedTarget('   ')).toBeNull();
    const typed = queryEmbedTarget('line one\nline two');
    expect(queryEmbedsIn(`:::query ${typed}:::`)).toEqual([typed]);
  });

  it('finds the embeds of a body, wherever the blocks are, and none in code', () => {
    const body = [
      ':::query dashboard:top:::',
      '- item\n\n  :::query inlist:::',
      '> quoted\n>\n> :::query inquote:::',
      '> [!NOTE]\n> note\n>\n> :::query incallout:::',
      '```\n:::query infence:::\n```',
      '    :::query indented:::',
      'and `:::query incode:::` inline',
      '<div>\n:::query inhtml:::\n</div>',
    ].join('\n\n');
    expect(queryEmbedsIn(body)).toEqual(['dashboard:top', 'inlist', 'inquote', 'incallout']);
  });
});
