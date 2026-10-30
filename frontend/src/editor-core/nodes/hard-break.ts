import HardBreak from '@tiptap/extension-hard-break';
import type { Node as PMNode } from '@tiptap/pm/model';

/* eslint-disable @typescript-eslint/no-explicit-any -- tiptap-markdown serializer state is untyped */

/**
 * Hard break with tiptap-markdown's serializer (`\` + newline, `<br>` in a table cell),
 * plus one fix: an ATX heading cannot span two lines, so a hard break in a heading
 * (a setext heading such as `a  \nhard\n---` has one) is written as a space. Writing
 * `\` + newline split the heading into a heading and a paragraph on the next parse.
 */
export const HardBreakNode = HardBreak.extend({
  addStorage() {
    return {
      ...this.parent?.(),
      markdown: {
        serialize(state: any, node: PMNode, parent: PMNode, index: number) {
          for (let i = index + 1; i < parent.childCount; i++) {
            if (parent.child(i).type !== node.type) {
              if (parent.type.name === 'heading') state.write(' ');
              else state.write(state.inTable ? '<br>' : '\\\n');
              return;
            }
          }
        },
        parse: {
          // handled by markdown-it
        },
      },
    };
  },
});
