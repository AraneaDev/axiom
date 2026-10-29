import { Node, mergeAttributes } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    collapsible: {
      setCollapsible: (attrs?: { title?: string }) => ReturnType;
    };
  }
}

/**
 * Collapsible section: schema, commands and Markdown rules shared by the browser
 * editor and the server converter. Serializes as `> [!DETAILS] Title`.
 * The browser adds its React node view on top of this.
 */
export const CollapsibleNode = Node.create({
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

  addStorage() {
    return {
      markdown: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        serialize(state: any, node: any) {
          const title = (node.attrs.title as string) || 'Click to expand';
          // The marker line goes inside the quote, so every line gets the current
          // indent (a section in a list item keeps the item's indent on each line).
          state.wrapBlock('> ', null, node, () => {
            state.write(`[!DETAILS] ${title}`);
            state.ensureNewLine();
            state.renderContent(node);
          });
        },
        parse: {
          updateDOM(element: HTMLElement) {
            element.querySelectorAll('blockquote').forEach((bq: Element) => {
              const firstP = bq.querySelector('p');
              if (!firstP) return;
              const firstNode = firstP.childNodes[0];
              if (!firstNode || firstNode.nodeType !== 3) return;
              const text = firstNode.textContent || '';
              const match = text.match(/^\[!DETAILS\]\s*(.*?)(?:\n|$)/);
              if (!match) return;
              const title = match[1].trim() || 'Click to expand';
              firstNode.textContent = text.slice(match[0].length);
              if (!firstNode.textContent.trim()) {
                const next = firstNode.nextSibling;
                if (next?.nodeName === 'BR') next.remove();
                if (!firstNode.textContent) firstNode.remove();
              }
              if (!firstP.innerHTML.trim()) firstP.remove();
              const div = bq.ownerDocument!.createElement('div');
              div.setAttribute('data-collapsible', '');
              div.setAttribute('data-title', title);
              div.setAttribute('data-open', 'true');
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
