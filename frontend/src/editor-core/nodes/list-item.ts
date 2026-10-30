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

/**
 * Bullet list: tiptap-markdown's serializer, written loose when tight is unsafe. Two
 * bullet lists in a row alternate their marker (`-`, then `*`), the way ordered lists
 * alternate `.` and `)`: with the same marker they parse back as one list.
 */
export const BulletListNode = BulletList.extend({
  addStorage() {
    return {
      ...this.parent?.(),
      markdown: {
        serialize(this: { editor: any }, state: any, node: PMNode, parent: PMNode, index: number) {
          const base = this.editor.storage.markdown.options.bulletListMarker || '-';
          const other = base === '*' ? '-' : '*';
          const marker = adjacentListIndex(node, parent, index) % 2 ? other : base;
          separateFromPreviousList(state, node);
          state.renderList(effectiveList(node), '  ', () => `${marker} `);
        },
        parse: {
          // handled by markdown-it
        },
      },
    };
  },
});

/**
 * prosemirror-markdown puts two blank lines between two lists of one type, which
 * CommonMark reads as one list again. The markers already tell the lists apart, so
 * one blank line is enough.
 * @param state - Serializer state.
 * @param node - The list about to be written.
 */
function separateFromPreviousList(state: any, node: PMNode): void {
  if (state.closed && state.closed.type === node.type) state.flushClose(2);
}

/**
 * How many lists of the same type come right before this one in its parent.
 * @param node - The list.
 * @param parent - Its parent.
 * @param index - Its index in the parent.
 */
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
          separateFromPreviousList(state, node);
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

/** Attribute that marks a bare task marker line found in the markdown-it token stream. */
const TASK_BOX_ATTR = 'data-task-box';

/**
 * markdown-it core rule: mark the task items that `TaskItemNode` writes as a bare
 * marker line (`- [ ] ` or `- [x] `, trailing space, block on the next line), which
 * markdown-it-task-lists does not recognise. Only the raw source counts: an escaped
 * `\[x\]` (literal text) is not a marker, a box without the trailing space is a plain
 * bullet (as on GitHub), and an ordered item is never a task item.
 * @param state - markdown-it core state.
 */
function markBareTaskMarkers(state: any): void {
  const tokens = state.tokens;
  const lines: string[] = state.src.split('\n');
  const lists: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type === 'bullet_list_open' || token.type === 'ordered_list_open') {
      lists.push(token.type);
    } else if (token.type === 'bullet_list_close' || token.type === 'ordered_list_close') {
      lists.pop();
    } else if (token.type === 'list_item_open' && lists[lists.length - 1] === 'bullet_list_open') {
      const [open, inline, close, next] = tokens.slice(i + 1, i + 5);
      const box = inline?.type === 'inline' ? /^\[([ xX])\]$/.exec(inline.content) : null;
      const map = open?.map;
      if (
        open.type !== 'paragraph_open' ||
        !box ||
        close?.type !== 'paragraph_close' ||
        !next ||
        next.type === 'list_item_close' ||
        !map ||
        map[1] - map[0] !== 1 ||
        !/\[[ xX]\][ \t]+$/.test(lines[map[0]] ?? '')
      ) {
        continue;
      }
      token.attrSet(TASK_BOX_ATTR, box[1] === ' ' ? 'false' : 'true');
    }
  }
}

/**
 * Whether a source line is blank, inside a blockquote (callout) too.
 * @param line - A source line, or undefined past the end.
 */
function isBlankLine(line: string | undefined): boolean {
  return line === undefined || /^[\s>]*$/.test(line);
}

/**
 * Whether any line in `[from, to)` is blank.
 * @param lines - Source lines.
 * @param from - First line.
 * @param to - Line after the last.
 */
function hasBlankLine(lines: string[], from: number, to: number): boolean {
  for (let n = from; n < to; n++) if (isBlankLine(lines[n])) return true;
  return false;
}

interface ListScan {
  open: number;
  close: number;
  items: number[];
}

/**
 * Whether a run of items, written as a list of its own, is tight: no blank line
 * between two of its items and none between two blocks of one item. markdown-it
 * decides tightness for the whole list, so a loose mixed list hides nothing.
 * @param tokens - The token stream.
 * @param lines - Source lines.
 * @param run - Indices of the run's `list_item_open` tokens.
 */
function runIsTight(tokens: any[], lines: string[], run: number[]): boolean {
  for (let k = 0; k < run.length; k++) {
    const item = tokens[run[k]];
    if (k > 0 && item.map && isBlankLine(lines[item.map[0] - 1])) return false;
    const children: any[] = [];
    for (let i = run[k] + 1; tokens[i] && tokens[i].level > item.level; i++) {
      const t = tokens[i];
      if (t.level === item.level + 1 && t.nesting >= 0 && t.map) children.push(t);
    }
    for (let c = 1; c < children.length; c++) {
      if (hasBlankLine(lines, children[c - 1].map[1], children[c].map[0])) return false;
    }
  }
  return true;
}

/**
 * markdown-it core rule: split a bullet list that mixes task items and plain items
 * into one list per run, as the editor holds them (a task list and a bullet list are
 * different nodes). Without the split ProseMirror forced the plain items out of the
 * task list and added an empty task item each time the page was normalised. Each run
 * is tight when its own items are, so `- a\n- b\n\n- [ ] t` keeps `a`/`b` tight.
 * Runs after `markBareTaskMarkers` and markdown-it-task-lists.
 * @param state - markdown-it core state.
 */
function splitMixedTaskLists(state: any): void {
  const tokens: any[] = state.tokens;
  const lines: string[] = state.src.split('\n');
  const stack: ListScan[] = [];
  const lists: ListScan[] = [];
  tokens.forEach((token, i) => {
    if (token.type === 'bullet_list_open' || token.type === 'ordered_list_open') {
      stack.push({ open: i, close: -1, items: [] });
    } else if (token.type === 'bullet_list_close' || token.type === 'ordered_list_close') {
      const list = stack.pop();
      if (list && token.type === 'bullet_list_close') lists.push({ ...list, close: i });
    } else if (token.type === 'list_item_open' && stack.length) {
      const top = stack[stack.length - 1];
      if (tokens[top.open].level + 1 === token.level) top.items.push(i);
    }
  });

  const isTask = (i: number) =>
    tokens[i].attrGet(TASK_BOX_ATTR) !== null ||
    (tokens[i].attrGet('class') ?? '').split(/\s+/).includes('task-list-item');
  const inserts: { at: number; tokens: any[] }[] = [];

  for (const list of lists) {
    const runs: number[][] = [];
    list.items.forEach((item, k) => {
      if (k > 0 && isTask(item) === isTask(list.items[k - 1])) runs[runs.length - 1].push(item);
      else runs.push([item]);
    });
    if (runs.length < 2) continue;
    const open = tokens[list.open];
    const close = tokens[list.close];
    const listLoose = !runIsTight(tokens, lines, list.items);
    runs.forEach((run, r) => {
      const task = isTask(run[0]);
      const runOpen = r === 0 ? open : new state.Token('bullet_list_open', 'ul', 1);
      runOpen.level = open.level;
      runOpen.markup = open.markup;
      runOpen.block = true;
      runOpen.attrs = task ? [['class', 'contains-task-list']] : null;
      if (r > 0) {
        const runClose = new state.Token('bullet_list_close', 'ul', -1);
        runClose.level = close.level;
        runClose.markup = close.markup;
        runClose.block = true;
        inserts.push({ at: run[0], tokens: [runClose, runOpen] });
      }
      if (!listLoose || !runIsTight(tokens, lines, run)) return;
      // Hide the run's paragraphs, as markdown-it does for a tight list
      for (const itemIndex of run) {
        const itemLevel = tokens[itemIndex].level;
        for (let i = itemIndex + 1; tokens[i] && tokens[i].level > itemLevel; i++) {
          const t = tokens[i];
          if (
            t.level === itemLevel + 1 &&
            (t.type === 'paragraph_open' || t.type === 'paragraph_close')
          ) {
            t.hidden = true;
          }
        }
      }
    });
  }

  inserts
    .sort((a, b) => b.at - a.at)
    .forEach(({ at, tokens: added }) => tokens.splice(at, 0, ...added));
}

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
          setup(markdownit: any) {
            markdownit.core.ruler.push('bare_task_marker', markBareTaskMarkers);
            markdownit.core.ruler.push('split_mixed_task_lists', splitMixedTaskLists);
          },
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
            // A task item written as a bare marker line, marked in the token stream by
            // `markBareTaskMarkers`: turn it into a task item before the placeholder
            // goes in. The box is the item's leading text (tight) or a lone <p> (loose).
            element.querySelectorAll(`li[${TASK_BOX_ATTR}]`).forEach((li) => {
              const checked = li.getAttribute(TASK_BOX_ATTR);
              li.removeAttribute(TASK_BOX_ATTR);
              const [marker, next] = [...li.childNodes].filter(
                (n) => n.nodeType !== 3 || n.textContent?.trim(),
              );
              const isBoxNode =
                marker &&
                (marker.nodeType === 3 ||
                  ((marker as Element).tagName === 'P' && marker.childNodes.length === 1)) &&
                /^\s*\[[ xX]\]\s*$/.test(marker.textContent ?? '');
              if (
                !isBoxNode ||
                !next ||
                next.nodeType !== 1 ||
                !BLOCK_TAGS.has((next as Element).tagName)
              ) {
                return;
              }
              li.removeChild(marker);
              li.setAttribute('data-type', 'taskItem');
              li.setAttribute('data-checked', checked ?? 'false');
              li.parentElement?.setAttribute('data-type', 'taskList');
            });
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
