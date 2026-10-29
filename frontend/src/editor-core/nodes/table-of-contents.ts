import { Node } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    tableOfContents: {
      insertTableOfContents: () => ReturnType;
    };
  }
}

/**
 * Table of contents block: schema, commands and Markdown rules shared by the
 * browser editor and the server converter. Serializes as `[TOC]`.
 * The browser adds its React node view on top of this.
 */
export const TableOfContentsNode = Node.create({
  name: 'tableOfContents',

  group: 'block',

  atom: true,

  parseHTML() {
    return [
      {
        tag: 'div[data-table-of-contents]',
      },
    ];
  },

  renderHTML() {
    return ['div', { 'data-table-of-contents': '', class: 'table-of-contents-block' }];
  },

  addStorage() {
    return {
      markdown: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        serialize(state: any, node: any) {
          state.write('[TOC]');
          state.closeBlock(node);
        },
        parse: {
          updateDOM(element: HTMLElement) {
            element.querySelectorAll('p').forEach((p: Element) => {
              if (p.textContent?.trim() === '[TOC]') {
                const div = p.ownerDocument!.createElement('div');
                div.setAttribute('data-table-of-contents', '');
                p.replaceWith(div);
              }
            });
          },
        },
      },
    };
  },

  addCommands() {
    return {
      insertTableOfContents:
        () =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
          });
        },
    };
  },
});
