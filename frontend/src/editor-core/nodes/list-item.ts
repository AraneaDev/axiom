import { Extension } from '@tiptap/core';
import { BulletList, ListItem, OrderedList } from '@tiptap/extension-list';
import type { Node as PMNode } from '@tiptap/pm/model';

/* eslint-disable @typescript-eslint/no-explicit-any -- tiptap-markdown serializer state is untyped */

/**
 * Whether a list's first line is a list marker with content. CommonMark lets a list
 * interrupt a paragraph only when its first item does not start empty.
 * @param list - A bullet or ordered list.
 */
function listStartsWithContent(list: PMNode): boolean {
  const first = list.firstChild?.firstChild;
  return !!first && (!first.isTextblock || first.content.size > 0);
}

/**
 * Blocks that interrupt a paragraph in CommonMark, so they can follow it on the
 * next line inside a tight list item. A list only interrupts a paragraph when its
 * first item has content, and an ordered list only when it starts at 1.
 * @param node - The block that follows.
 */
function interruptsParagraph(node: PMNode): boolean {
  switch (node.type.name) {
    case 'codeBlock':
    case 'blockquote':
    case 'callout':
    case 'collapsible':
    case 'heading':
      return true;
    case 'bulletList':
      return listStartsWithContent(node);
    case 'orderedList':
      return (node.attrs.start ?? 1) === 1 && listStartsWithContent(node);
    default:
      return false;
  }
}

/**
 * The blocks of a list item as written. An empty first paragraph followed by more
 * blocks is not written: the item becomes a bare marker line with the next block on
 * the line below (CommonMark's "item starting with a blank line"; a blank line there
 * would end the item). `ListItemFirstBlock` puts the empty paragraph back on parse.
 * @param item - A list item.
 */
function writtenChildren(item: PMNode): PMNode[] {
  const children: PMNode[] = [];
  item.forEach((child) => children.push(child));
  const [first] = children;
  if (children.length > 1 && first.type.name === 'paragraph' && first.content.size === 0) {
    return children.slice(1);
  }
  return children;
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
    const children = writtenChildren(item);
    for (let i = 1; i < children.length; i++) {
      if (!canJoinTightly(children[i - 1], children[i])) safe = false;
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
 * keep a list tight when that join is safe. An empty first paragraph before other
 * blocks is not written (see `writtenChildren`).
 */
export const ListItemNode = ListItem.extend({
  addStorage() {
    return {
      ...this.parent?.(),
      markdown: {
        serialize(state: any, node: PMNode) {
          const children = writtenChildren(node);
          const offset = node.childCount - children.length;
          // Bare marker line: the first written block goes on the next line, no blank line
          if (offset) state.ensureNewLine();
          children.forEach((child, i) => {
            if (i && state.inTightList) state.flushClose(1);
            state.render(child, node, i + offset);
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

const BLOCK_TAGS = new Set([
  'PRE',
  'UL',
  'OL',
  'BLOCKQUOTE',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'HR',
  'DIV',
  'TABLE',
]);

/**
 * Parse fix: a list item whose content starts with a block (code block, heading,
 * quote, callout, list, rule, embed) gets an empty first paragraph, as the schema
 * requires (`paragraph block*`). Without it ProseMirror moved the block out of the
 * list. Registered last, so it sees the DOM after the other nodes' `updateDOM`.
 */
export const ListItemFirstBlock = Extension.create({
  name: 'listItemFirstBlock',

  addStorage() {
    return {
      markdown: {
        parse: {
          updateDOM(element: HTMLElement) {
            // markdown-it marks a tight list by leaving out its items' own <p>. The
            // stock rule (no <p> anywhere inside) also counted paragraphs nested in a
            // quote or callout, and would count the placeholders below; mark tight
            // lists explicitly from their items' direct children instead.
            const tightLists = [...element.querySelectorAll('ul, ol')].filter((list) =>
              [...list.children].every(
                (li) => li.tagName !== 'LI' || ![...li.children].some((c) => c.tagName === 'P'),
              ),
            );
            element.querySelectorAll('li').forEach((li) => {
              let first = li.firstChild;
              while (first && first.nodeType === 3 && !first.textContent?.trim()) {
                first = first.nextSibling;
              }
              if (first && first.nodeType === 1 && BLOCK_TAGS.has((first as Element).tagName)) {
                li.insertBefore(li.ownerDocument.createElement('p'), first);
              }
            });
            tightLists.forEach((list) => list.setAttribute('data-tight', 'true'));
          },
        },
      },
    };
  },
});
