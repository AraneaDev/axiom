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
 * Escape the cell separators in one serialized cell.
 *
 * GFM splits a row on every `|` not preceded by a backslash, and removes the
 * backslash of each `\|` it skips, inside code spans too. Plain text arrives
 * escaped already (`\|`, `\\`), so outside code only bare pipes get a backslash.
 * Code span text is written raw, so there every `|` gets one: the code `a\|b`
 * is written `a\\|b` and reads back as `a\|b`.
 * @param cell - The serialized cell content.
 */
function escapeCellPipes(cell: string): string {
  let out = '';
  let i = 0;
  while (i < cell.length) {
    const ch = cell[i];
    if (ch === '\\' && i + 1 < cell.length) {
      out += ch + cell[i + 1];
      i += 2;
      continue;
    }
    if (ch === '`') {
      const run = cell.slice(i).match(/^`+/)![0];
      const close = cell.indexOf(run, i + run.length);
      // A matching run of the same length closes the code span
      if (close !== -1 && cell[close + run.length] !== '`') {
        const code = cell.slice(i + run.length, close);
        out += run + code.replace(/\|/g, '\\|') + run;
        i = close + run.length;
        continue;
      }
      out += run;
      i += run.length;
      continue;
    }
    out += ch === '|' ? '\\|' : ch;
    i++;
  }
  return out;
}

/**
 * Table with tiptap-markdown's GFM serializer, plus two fixes: pipes inside code
 * spans in a cell are escaped (see `escapeCellPipes`; tiptap-markdown left them bare,
 * which split the cell on the next parse), and a cell whose only content is an inline
 * atom (mention, issue reference, smart link, image) is no longer written empty.
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
              if (cellContent && cellContent.childCount > 0) {
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
