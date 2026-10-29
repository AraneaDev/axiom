import { BulletList, ListItem, OrderedList } from '@tiptap/extension-list';
import type { Node as PMNode } from '@tiptap/pm/model';

/* eslint-disable @typescript-eslint/no-explicit-any -- tiptap-markdown serializer state is untyped */

/**
 * Blocks that interrupt a paragraph in CommonMark, so they can follow it on the
 * next line inside a tight list item. An ordered list only interrupts a paragraph
 * when it starts at 1.
 * @param node - The block that follows.
 */
function interruptsParagraph(node: PMNode): boolean {
  switch (node.type.name) {
    case 'codeBlock':
    case 'bulletList':
    case 'blockquote':
    case 'callout':
    case 'collapsible':
    case 'heading':
      return true;
    case 'orderedList':
      return (node.attrs.start ?? 1) === 1;
    default:
      return false;
  }
}

/**
 * Whether two blocks of one list item may be written on consecutive lines. The
 * previous block must end cleanly (no lazy continuation line), and the next block
 * must start a block of its own.
 * @param prev - The earlier block.
 * @param next - The block after it.
 */
function canJoinTightly(prev: PMNode, next: PMNode): boolean {
  const prevEndsCleanly =
    prev.type.name === 'paragraph' ||
    prev.type.name === 'heading' ||
    prev.type.name === 'codeBlock';
  return prevEndsCleanly && interruptsParagraph(next);
}

/**
 * Whether a tight list can be written tight without changing its structure: every
 * item's blocks must be joinable on consecutive lines.
 * @param list - A bullet or ordered list.
 */
function tightIsSafe(list: PMNode): boolean {
  let safe = true;
  list.forEach((item) => {
    for (let i = 1; i < item.childCount; i++) {
      if (!canJoinTightly(item.child(i - 1), item.child(i))) safe = false;
    }
  });
  return safe;
}

/**
 * The list to serialize: a tight list whose items cannot be written tight is
 * written loose, so no block merges into its neighbour on the next parse.
 * @param list - A bullet or ordered list.
 */
function effectiveList(list: PMNode): PMNode {
  if (!list.attrs.tight || tightIsSafe(list)) return list;
  return list.type.create({ ...list.attrs, tight: false }, list.content, list.marks);
}

/**
 * List item with one fix over the prosemirror-markdown default: inside a tight
 * list, the blocks of one item (a paragraph followed by a code block, say) are
 * separated by a single newline. The default puts a blank line between them,
 * which turns the whole list loose on the next parse. The list nodes below only
 * keep a list tight when that join is safe.
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

/** Bullet list: tiptap-markdown's serializer, written loose when tight is unsafe. */
export const BulletListNode = BulletList.extend({
  addStorage() {
    return {
      ...this.parent?.(),
      markdown: {
        serialize(this: { editor: any }, state: any, node: PMNode) {
          const marker = this.editor.storage.markdown.options.bulletListMarker || '-';
          state.renderList(effectiveList(node), '  ', () => `${marker} `);
        },
        parse: {
          // handled by markdown-it
        },
      },
    };
  },
});

function adjacentListIndex(node: PMNode, parent: PMNode, index: number): number {
  let i = 0;
  for (; index - i > 0; i++) {
    if (parent.child(index - i - 1).type.name !== node.type.name) break;
  }
  return i;
}

/** Ordered list: tiptap-markdown's serializer, written loose when tight is unsafe. */
export const OrderedListNode = OrderedList.extend({
  addStorage() {
    return {
      ...this.parent?.(),
      markdown: {
        serialize(state: any, node: PMNode, parent: PMNode, index: number) {
          const start = node.attrs.start || 1;
          const maxW = String(start + node.childCount - 1).length;
          const space = state.repeat(' ', maxW + 2);
          const separator = adjacentListIndex(node, parent, index) % 2 ? ') ' : '. ';
          state.renderList(effectiveList(node), space, (i: number) => {
            const nStr = String(start + i);
            return state.repeat(' ', maxW - nStr.length) + nStr + separator;
          });
        },
        parse: {
          // handled by markdown-it
        },
      },
    };
  },
});
