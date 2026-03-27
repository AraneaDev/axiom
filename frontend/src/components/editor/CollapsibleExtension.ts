import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';

import { CollapsibleBlock } from './CollapsibleBlock';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    collapsible: {
      setCollapsible: (attrs?: { title?: string }) => ReturnType;
    };
  }
}

export const CollapsibleExtension = Node.create({
  name: 'collapsible',

  group: 'block',

  content: 'block+',

  defining: true,

  addAttributes() {
    return {
      title: {
        default: 'Click to expand',
        parseHTML: (element: HTMLElement) =>
          element.getAttribute('data-title') || 'Click to expand',
        renderHTML: (attributes: Record<string, unknown>) => ({
          'data-title': attributes.title,
        }),
      },
      open: {
        default: true,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-open') !== 'false',
        renderHTML: (attributes: Record<string, unknown>) => ({
          'data-open': String(attributes.open),
        }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-collapsible]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-collapsible': '', class: 'collapsible-block' }),
      0,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(CollapsibleBlock);
  },

  addCommands() {
    return {
      setCollapsible:
        (attrs) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: { title: attrs?.title || 'Click to expand', open: true },
            content: [{ type: 'paragraph' }],
          });
        },
    };
  },
});
