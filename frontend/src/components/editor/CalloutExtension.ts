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

  addStorage() {
    return {
      markdown: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        serialize(state: any, node: any) {
          const typeMap: Record<string, string> = {
            info: 'NOTE',
            warning: 'WARNING',
            note: 'NOTE',
            success: 'TIP',
            error: 'CAUTION',
          };
          const alertType = typeMap[node.attrs.type as string] || 'NOTE';
          state.wrapBlock('> ', `> [!${alertType}]\n> `, node, () => state.renderContent(node));
        },
        parse: {
          updateDOM(element: HTMLElement) {
            element.querySelectorAll('blockquote').forEach((bq: Element) => {
              const firstP = bq.querySelector('p');
              if (!firstP) return;
              const firstNode = firstP.childNodes[0];
              if (!firstNode || firstNode.nodeType !== 3) return;
              const text = firstNode.textContent || '';
              const match = text.match(/^\[!(NOTE|WARNING|TIP|CAUTION|IMPORTANT)\]\s*/);
              if (!match) return;
              const reverseMap: Record<string, string> = {
                NOTE: 'info',
                WARNING: 'warning',
                TIP: 'success',
                CAUTION: 'error',
                IMPORTANT: 'warning',
              };
              firstNode.textContent = text.slice(match[0].length);
              if (!firstNode.textContent.trim()) {
                const next = firstNode.nextSibling;
                if (next?.nodeName === 'BR') next.remove();
                if (!firstNode.textContent) firstNode.remove();
              }
              if (!firstP.innerHTML.trim()) firstP.remove();
              const div = bq.ownerDocument!.createElement('div');
              div.setAttribute('data-callout-type', reverseMap[match[1]] || 'info');
              div.innerHTML = bq.innerHTML;
              bq.replaceWith(div);
            });
          },
        },
      },
    };
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
