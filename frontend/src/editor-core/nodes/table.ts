import { getHTMLFromFragment } from '@tiptap/core';
import { Table } from '@tiptap/extension-table';
import { Fragment, type Node as PMNode } from '@tiptap/pm/model';

/* eslint-disable @typescript-eslint/no-explicit-any -- tiptap-markdown serializer state is untyped */

function hasSpan(cell: PMNode): boolean {
  return cell.attrs.colspan > 1 || cell.attrs.rowspan > 1;
}

/**
 * Same rule as tiptap-markdown: GFM can only express one header row and single-paragraph cells.
 * @param table - The table node.
 */
function isMarkdownSerializable(table: PMNode): boolean {
  const rows: PMNode[] = [];
  table.forEach((row) => rows.push(row));
  const [firstRow, ...bodyRows] = rows;
  if (!firstRow) return false;
  let ok = true;
  firstRow.forEach((cell) => {
    if (cell.type.name !== 'tableHeader' || hasSpan(cell) || cell.childCount > 1) ok = false;
  });
  for (const row of bodyRows) {
    row.forEach((cell) => {
      if (cell.type.name === 'tableHeader' || hasSpan(cell) || cell.childCount > 1) ok = false;
    });
  }
  return ok;
}

/**
 * tiptap-markdown's HTML fallback for a table GFM cannot express.
 * @param state - Serializer state.
 * @param node - The table node.
 * @param parent - The parent node or fragment.
 */
function serializeAsHTML(state: any, node: PMNode, parent: any) {
  const html = getHTMLFromFragment(Fragment.from(node), node.type.schema);
  const isTopLevel =
    parent instanceof Fragment || parent?.type?.name === node.type.schema.topNodeType.name;
  if (isTopLevel) {
    const body = new window.DOMParser().parseFromString(`<body>${html}</body>`, 'text/html').body;
    const element = body.firstElementChild!;
    element.innerHTML = element.innerHTML.trim() ? `\n${element.innerHTML}\n` : '\n';
    state.write(element.outerHTML);
  } else {
    state.write(html);
  }
  state.closeBlock(node);
}

/**
 * Escape the cell separator inside code spans; plain text is already escaped by the serializer.
 * @param cell - The serialized cell content.
 */
function escapeCellPipes(cell: string): string {
  return cell.replace(/(^|[^\\])\|/g, '$1\\|').replace(/(^|[^\\])\|/g, '$1\\|');
}

/**
 * Table with tiptap-markdown's GFM serializer, plus one fix: a `|` inside a code
 * span in a cell is written as `\|`. tiptap-markdown leaves it bare, which splits
 * the cell on the next parse (GFM strips the backslash again, so `` `a\|b` `` reads
 * back as the code `a|b`).
 */
export const TableNode = Table.extend({
  addStorage() {
    return {
      ...this.parent?.(),
      markdown: {
        serialize(state: any, node: PMNode, parent: any) {
          if (!isMarkdownSerializable(node)) {
            serializeAsHTML(state, node, parent);
            return;
          }
          state.inTable = true;
          node.forEach((row, _p, i) => {
            state.write('| ');
            row.forEach((col, _q, j) => {
              if (j) state.write(' | ');
              const cellContent = col.firstChild;
              if (cellContent && cellContent.textContent.trim()) {
                const start = state.out.length;
                state.renderInline(cellContent);
                state.out = state.out.slice(0, start) + escapeCellPipes(state.out.slice(start));
              }
            });
            state.write(' |');
            state.ensureNewLine();
            if (!i) {
              const delimiterRow = Array.from({ length: row.childCount })
                .map(() => '---')
                .join(' | ');
              state.write(`| ${delimiterRow} |`);
              state.ensureNewLine();
            }
          });
          state.closeBlock(node);
          state.inTable = false;
        },
        parse: {
          // handled by markdown-it
        },
      },
    };
  },
});
