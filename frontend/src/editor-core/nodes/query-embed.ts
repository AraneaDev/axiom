import { Node, mergeAttributes } from '@tiptap/core';
import type MarkdownIt from 'markdown-it';

import { queryEmbedTargetOfLine } from '../query-embed-target';

/* eslint-disable @typescript-eslint/no-explicit-any -- tiptap-markdown serializer state and
   markdown-it's rule state are untyped (their classes are not exported by the type package) */

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    queryEmbed: {
      setQueryEmbed: (attrs: { target: string }) => ReturnType;
    };
  }
}

const PATCHED = Symbol.for('axiom.queryEmbed');
const RULE = 'axiom_query_embed';

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * The block rule for an embed line. As a block of its own, the line's text never goes through the
 * inline rules, which would eat a query's `_`, `*`, backslashes and tags. Paragraphs do not end at
 * one, so an embed line inside a paragraph stays text, as an issue embed's does.
 * @param state - markdown-it's block state
 * @param startLine - The line to read
 * @param _endLine - Unused
 * @param silent - Only say whether it matches
 */
function queryEmbedBlock(state: any, startLine: number, _endLine: number, silent: boolean) {
  if (state.sCount[startLine] - state.blkIndent >= 4) return false;
  const line = state.src.slice(
    state.bMarks[startLine] + state.tShift[startLine],
    state.eMarks[startLine],
  );
  const target = queryEmbedTargetOfLine(line);
  if (target === null) return false;
  if (silent) return true;
  const token = state.push(RULE, 'div', 0);
  token.map = [startLine, startLine + 1];
  token.content = target;
  state.line = startLine + 1;
  return true;
}

/**
 * Patch the markdown-it instance once.
 * @param markdownit - tiptap-markdown's markdown-it instance
 */
function setupQueryEmbed(markdownit: MarkdownIt) {
  const md = markdownit as MarkdownIt & { [PATCHED]?: boolean };
  if (md[PATCHED]) return;
  md[PATCHED] = true;
  // Ahead of the table and setext heading rules, which could read the next line as part of it
  md.block.ruler.after('code', RULE, queryEmbedBlock);
  md.renderer.rules[RULE] = (tokens, idx) =>
    `<div data-query-embed="" data-query-target="${escapeAttribute(tokens[idx].content)}"></div>`;
}

/**
 * Live query or dashboard block: schema, commands and Markdown rules shared by the browser editor
 * and the server converter. Serializes as `:::query <target>:::`, the target exactly as written.
 * The browser adds its live node view on top of this.
 */
export const QueryEmbedNode = Node.create({
  name: 'queryEmbed',

  group: 'block',

  atom: true,

  addAttributes() {
    return {
      target: {
        default: '',
        parseHTML: (element: HTMLElement) => element.getAttribute('data-query-target') || '',
        renderHTML: (attributes: Record<string, unknown>) => ({
          'data-query-target': attributes.target,
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-query-embed]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-query-embed': '' }),
      `Query: ${HTMLAttributes['data-query-target'] ?? ''}`,
    ];
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: any) {
          state.write(`:::query ${(node.attrs.target as string) || ''}:::`);
          state.closeBlock(node);
        },
        parse: {
          setup: setupQueryEmbed,
        },
      },
    };
  },

  addCommands() {
    return {
      setQueryEmbed:
        (attrs) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: { target: attrs.target },
          });
        },
    };
  },
});
