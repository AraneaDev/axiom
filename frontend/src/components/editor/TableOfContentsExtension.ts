import { Node } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';

import { TableOfContentsBlock } from './TableOfContentsBlock';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    tableOfContents: {
      insertTableOfContents: () => ReturnType;
    };
  }
}

export const TableOfContentsExtension = Node.create({
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

  addNodeView() {
    return ReactNodeViewRenderer(TableOfContentsBlock);
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
