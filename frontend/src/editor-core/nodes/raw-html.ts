import { Node } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import type MarkdownIt from 'markdown-it';

/* eslint-disable @typescript-eslint/no-explicit-any -- tiptap-markdown serializer state is untyped */

const PATCHED = Symbol.for('axiom.rawHtmlBlock');

/**
 * HTML blocks the schema parses into real nodes. tiptap-markdown writes a table
 * that GFM cannot express (merged cells, several paragraphs in a cell) as an HTML
 * `<table>` block, so that one must keep parsing as a table.
 * @param html - The HTML block source.
 */
function isStructuralHtml(html: string): boolean {
  return /^\s*<table[\s>]/i.test(html);
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Raw HTML block: keeps a Markdown HTML block (`<details>…</details>`, a bare
 * `<div>`) verbatim instead of letting the editor flatten it into text.
 *
 * It parses from markdown-it's `html_block` token and writes the source back
 * unchanged. In the editor it shows as a read-only source block.
 */
export const RawHtmlNode = Node.create({
  name: 'rawHtml',

  group: 'block',

  atom: true,

  addAttributes() {
    return {
      html: {
        default: '',
        parseHTML: (element: HTMLElement) => element.getAttribute('data-raw-html') ?? '',
        renderHTML: (attributes: Record<string, unknown>) => ({
          'data-raw-html': attributes.html,
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-raw-html]', priority: 60 }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return ['div', { ...HTMLAttributes, class: 'raw-html-block' }, node.attrs.html as string];
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: PMNode) {
          state.text(node.attrs.html as string, false);
          state.closeBlock(node);
        },
        parse: {
          setup(markdownit: MarkdownIt) {
            const md = markdownit as MarkdownIt & { [PATCHED]?: boolean };
            if (md[PATCHED]) return;
            md[PATCHED] = true;
            const original = md.renderer.rules.html_block;
            md.renderer.rules.html_block = (tokens, idx, options, env, self) => {
              const content = tokens[idx].content;
              if (isStructuralHtml(content)) {
                return original ? original(tokens, idx, options, env, self) : content;
              }
              const html = content.replace(/\n+$/, '');
              return `<div data-raw-html="${escapeAttribute(html)}"></div>`;
            };
          },
        },
      },
    };
  },
});
