import Code from '@tiptap/extension-code';

/**
 * Inline code that can carry other marks, so `**`x`**`, `*`x`*`, `~~`x`~~` and
 * links around code survive a round trip (TipTap's code mark excludes every other
 * mark, which dropped them).
 *
 * The lower priority makes code the innermost mark in the schema. prosemirror-markdown
 * expects the code mark last: it writes the code text unescaped only then.
 */
export const CodeNode = Code.extend({
  priority: 50,
  excludes: 'code',
});
