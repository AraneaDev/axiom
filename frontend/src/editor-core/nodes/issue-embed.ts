import { Node, mergeAttributes } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    issueEmbed: {
      setIssueEmbed: (attrs: { issueKey: string }) => ReturnType;
    };
  }
}

/**
 * Issue embed block: schema, commands and Markdown rules shared by the browser
 * editor and the server converter. Serializes as `:::issue AXM-123:::`.
 * The browser adds its live issue card node view on top of this.
 */
export const IssueEmbedNode = Node.create({
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
            // A tight list item has no <p>: the embed line is the item's leading text
            element.querySelectorAll('li').forEach((li: Element) => {
              const text = li.firstChild;
              if (
                !text ||
                text.nodeType !== 3 ||
                (text.nextSibling && text.nextSibling.nodeType !== 1)
              )
                return;
              const match = (text.textContent || '').trim().match(/^:::issue\s+([A-Z]+-\d+):::$/);
              if (!match) return;
              const div = li.ownerDocument!.createElement('div');
              div.setAttribute('data-issue-embed', '');
              div.setAttribute('data-issue-key', match[1]);
              div.textContent = `Issue: ${match[1]}`;
              li.replaceChild(div, text);
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
