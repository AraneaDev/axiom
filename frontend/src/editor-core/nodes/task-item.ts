import TaskItem from '@tiptap/extension-task-item';
import type { Node as PMNode } from '@tiptap/pm/model';

/* eslint-disable @typescript-eslint/no-explicit-any -- tiptap-markdown serializer state is untyped */

/**
 * Task item with tiptap-markdown's serializer (`[ ] ` / `[x] ` then the content), plus
 * the bare-marker-line form of the list items: an empty first paragraph followed by
 * more blocks is not written, and the next block goes on the line below the marker.
 * `ListItemFirstBlock` reads such an item back as a task item with its empty paragraph.
 */
export const TaskItemNode = TaskItem.extend({
  addStorage() {
    return {
      ...this.parent?.(),
      markdown: {
        serialize(state: any, node: PMNode) {
          state.write(node.attrs.checked ? '[x] ' : '[ ] ');
          const first = node.firstChild;
          const bareMarker =
            node.childCount > 1 && first?.type.name === 'paragraph' && first.content.size === 0;
          if (!bareMarker) {
            state.renderContent(node);
            return;
          }
          state.ensureNewLine();
          node.forEach((child, _offset, i) => {
            if (i) state.render(child, node, i);
          });
        },
        // No `parse` key: tiptap-markdown merges this spec shallowly over its own, and
        // its task item parse step (checkbox to `data-checked`) must stay.
      },
    };
  },
});
