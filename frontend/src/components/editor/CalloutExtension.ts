import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';

import { CalloutBlock } from './CalloutBlock';

export type CalloutType = 'info' | 'warning' | 'note' | 'success' | 'error';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    callout: {
      setCallout: (attrs?: { type?: CalloutType }) => ReturnType;
    };
  }
}

export const CalloutExtension = Node.create({
  name: 'callout',

  group: 'block',

  content: 'block+',

  defining: true,

  addAttributes() {
    return {
      type: {
        default: 'info' as CalloutType,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-callout-type') || 'info',
        renderHTML: (attributes: Record<string, unknown>) => ({
          'data-callout-type': attributes.type,
        }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-callout-type]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { class: 'callout-block' }), 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(CalloutBlock);
  },

  addCommands() {
    return {
      setCallout:
        (attrs) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: { type: attrs?.type || 'info' },
            content: [{ type: 'paragraph' }],
          });
        },
    };
  },
});
