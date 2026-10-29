import { ListItem } from '@tiptap/extension-list';
import type { Node as PMNode } from '@tiptap/pm/model';

/* eslint-disable @typescript-eslint/no-explicit-any -- tiptap-markdown serializer state is untyped */

/**
 * List item with one fix over the prosemirror-markdown default: inside a tight
 * list, the blocks of one item (a paragraph followed by a code block, say) are
 * separated by a single newline. The default puts a blank line between them,
 * which turns the whole list loose on the next parse.
 */
export const ListItemNode = ListItem.extend({
  addStorage() {
    return {
      ...this.parent?.(),
      markdown: {
        serialize(state: any, node: PMNode) {
          if (!state.inTightList) {
            state.renderContent(node);
            return;
          }
          node.forEach((child, _offset, i) => {
            if (i) state.flushClose(1);
            state.render(child, node, i);
          });
        },
        parse: {
          // handled by markdown-it
        },
      },
    };
  },
});
