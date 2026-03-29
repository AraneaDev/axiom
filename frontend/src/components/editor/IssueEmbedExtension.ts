import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';

import IssueEmbedNode from './IssueEmbedNode';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    issueEmbed: {
      setIssueEmbed: (attrs: { issueKey: string }) => ReturnType;
    };
  }
}

/**
 * TipTap block node that renders a live issue card.
 * Serializes to markdown as `:::issue AXM-123:::`.
 */
export const IssueEmbedExtension = Node.create({
  name: 'issueEmbed',

  group: 'block',

  atom: true,

  addAttributes() {
    return {
      issueKey: {
        default: '',
        parseHTML: (element: HTMLElement) => element.getAttribute('data-issue-key') || '',
        renderHTML: (attributes: Record<string, unknown>) => ({
          'data-issue-key': attributes.issueKey,
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-issue-embed]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-issue-embed': '' }),
      `Issue: ${HTMLAttributes['data-issue-key'] ?? ''}`,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(IssueEmbedNode);
  },

  addStorage() {
    return {
      markdown: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TipTap markdown serializer types
        serialize(state: any, node: any) {
          const key = (node.attrs.issueKey as string) || '';
          state.write(`:::issue ${key}:::\n`);
          state.closeBlock(node);
        },
        parse: {
          updateDOM(element: HTMLElement) {
            element.querySelectorAll('p').forEach((p: Element) => {
              const text = p.textContent || '';
              const match = text.match(/^:::issue\s+([A-Z]+-\d+):::$/);
              if (!match) return;
              const div = p.ownerDocument!.createElement('div');
              div.setAttribute('data-issue-embed', '');
              div.setAttribute('data-issue-key', match[1]);
              div.textContent = `Issue: ${match[1]}`;
              p.replaceWith(div);
            });
          },
        },
      },
    };
  },

  addCommands() {
    return {
      setIssueEmbed:
        (attrs) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: { issueKey: attrs.issueKey },
          });
        },
    };
  },
});
