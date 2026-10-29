import { Node } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import type MarkdownIt from 'markdown-it';

/* eslint-disable @typescript-eslint/no-explicit-any -- tiptap-markdown serializer state and
   markdown-it's rule state are untyped (their classes are not exported by the type package) */

type StateBlock = any;
type StateInline = any;
type Token = { type: string; content: string };

const PATCHED = Symbol.for('axiom.rawPassthrough');

/**
 * HTML blocks the schema parses into real nodes. tiptap-markdown writes a table
 * that GFM cannot express (merged cells, several paragraphs in a cell) as an HTML
 * `<table>` block, so that one must keep parsing as a table.
 * @param html - The HTML block source.
 */
function isStructuralHtml(html: string): boolean {
  return /^\s*<table[\s>]/i.test(html);
}

/** Inline tags the schema reads into marks or nodes (formatting may normalise, content stays). */
const STRUCTURAL_INLINE_TAGS = new Set([
  'a',
  'b',
  'br',
  'code',
  'del',
  'em',
  'i',
  'img',
  // markdown-it-task-lists renders task checkboxes as inline `<input>` tags
  'input',
  's',
  'strike',
  'strong',
  'u',
]);

/**
 * A `<span>` the schema reads as a node: issue reference, mention or smart link.
 * @param tag - The opening tag source.
 */
function isStructuralSpan(tag: string): boolean {
  return /\sdata-issue-key=|\sdata-smart-link[\s=>]|\sclass="[^"]*\bmention\b/i.test(tag);
}

function tagName(html: string): { name: string; closing: boolean } | null {
  const match = html.match(/^<(\/?)([a-zA-Z][a-zA-Z0-9-]*)/);
  return match ? { name: match[2].toLowerCase(), closing: match[1] === '/' } : null;
}

/**
 * Whether an inline HTML token maps onto the schema. A closing `</span>` follows
 * its opening tag, found by walking back over the inline tokens.
 * @param tokens - The inline tokens of one block.
 * @param idx - The `html_inline` token.
 */
function isStructuralInline(tokens: Token[], idx: number): boolean {
  const tag = tagName(tokens[idx].content);
  if (!tag) return false;
  if (tag.name !== 'span') return STRUCTURAL_INLINE_TAGS.has(tag.name);
  if (!tag.closing) return isStructuralSpan(tokens[idx].content);
  let depth = 0;
  for (let i = idx - 1; i >= 0; i--) {
    if (tokens[i].type !== 'html_inline') continue;
    const other = tagName(tokens[i].content);
    if (!other || other.name !== 'span') continue;
    if (other.closing) depth++;
    else if (depth === 0) return isStructuralSpan(tokens[i].content);
    else depth--;
  }
  return false;
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const FOOTNOTE_DEFINITION = /^\[\^[^\]\s]+\]:/;

/**
 * Block rule: a footnote definition (`[^1]: text`, plus indented continuation
 * lines) becomes a raw block, so markdown-it never turns it into a link reference.
 * @param state - Block state.
 * @param startLine - First line.
 * @param endLine - Last line.
 * @param silent - Validation mode.
 */
function footnoteDefinition(
  state: StateBlock,
  startLine: number,
  endLine: number,
  silent: boolean,
): boolean {
  const start = state.bMarks[startLine] + state.tShift[startLine];
  if (state.sCount[startLine] - state.blkIndent >= 4) return false;
  const firstLine = state.src.slice(start, state.eMarks[startLine]);
  if (!FOOTNOTE_DEFINITION.test(firstLine)) return false;
  if (silent) return true;
  let line = startLine + 1;
  while (line < endLine && !state.isEmpty(line) && state.sCount[line] - state.blkIndent >= 2) {
    line++;
  }
  const token = state.push('html_block', '', 0);
  token.map = [startLine, line];
  token.content = state.getLines(startLine, line, state.blkIndent, true);
  state.line = line;
  return true;
}

/**
 * Inline rule: a footnote reference (`[^1]`) becomes raw inline text instead of a
 * link or escaped brackets.
 * @param state - Inline state.
 * @param silent - Validation mode.
 */
function footnoteReference(state: StateInline, silent: boolean): boolean {
  const match = state.src.slice(state.pos).match(/^\[\^[^\]\s]+\](?!:)/);
  if (!match) return false;
  if (!silent) {
    const token = state.push('html_inline', '', 0);
    token.content = match[0];
  }
  state.pos += match[0].length;
  return true;
}

/**
 * Patch the markdown-it instance once: raw blocks and raw inline tags become
 * passthrough nodes, and footnotes are kept as raw source.
 * @param markdownit - tiptap-markdown's markdown-it instance.
 */
function setupPassthrough(markdownit: MarkdownIt) {
  const md = markdownit as MarkdownIt & { [PATCHED]?: boolean };
  if (md[PATCHED]) return;
  md[PATCHED] = true;

  md.block.ruler.before('reference', 'axiom_footnote_definition', footnoteDefinition);
  md.inline.ruler.before('link', 'axiom_footnote_reference', footnoteReference);

  const originalBlock = md.renderer.rules.html_block;
  md.renderer.rules.html_block = (tokens, idx, options, env, self) => {
    const content = tokens[idx].content;
    if (isStructuralHtml(content)) {
      return originalBlock ? originalBlock(tokens, idx, options, env, self) : content;
    }
    const html = content.replace(/\n+$/, '');
    return `<div data-raw-html="${escapeAttribute(html)}"></div>`;
  };

  const originalInline = md.renderer.rules.html_inline;
  md.renderer.rules.html_inline = (tokens, idx, options, env, self) => {
    if (isStructuralInline(tokens, idx)) {
      return originalInline ? originalInline(tokens, idx, options, env, self) : tokens[idx].content;
    }
    return `<span data-raw-html-inline="${escapeAttribute(tokens[idx].content)}"></span>`;
  };
}

/**
 * Raw HTML block: keeps a Markdown HTML block (`<details>…</details>`, a bare
 * `<div>`) or a footnote definition verbatim instead of letting the editor flatten
 * it into text.
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
          setup: setupPassthrough,
        },
      },
    };
  },
});

/**
 * Raw inline HTML: one inline tag the schema has no mark for (`<kbd>`, `</kbd>`,
 * `<sub>`, a styled `<span>`), or a footnote reference, kept verbatim. The text
 * between an opening and a closing tag stays ordinary text.
 *
 * In the editor it shows as the tag's source text (never as live HTML).
 */
export const RawHtmlInlineNode = Node.create({
  name: 'rawHtmlInline',

  group: 'inline',

  inline: true,

  atom: true,

  addAttributes() {
    return {
      html: {
        default: '',
        parseHTML: (element: HTMLElement) => element.getAttribute('data-raw-html-inline') ?? '',
        renderHTML: (attributes: Record<string, unknown>) => ({
          'data-raw-html-inline': attributes.html,
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-raw-html-inline]', priority: 60 }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return ['span', { ...HTMLAttributes, class: 'raw-html-inline' }, node.attrs.html as string];
  },

  renderText({ node }) {
    return node.attrs.html as string;
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: PMNode) {
          state.text(node.attrs.html as string, false);
        },
        parse: {
          setup: setupPassthrough,
        },
      },
    };
  },
});
