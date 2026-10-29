import { Node, mergeAttributes } from '@tiptap/core';

export interface IssueReferenceOptions {
  HTMLAttributes: Record<string, string>;
  projectId: string | null;
  instanceId: number | null;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    issueReference: {
      insertIssueReference: (key: string) => ReturnType;
    };
  }
}

/**
 * Inline issue reference (e.g. ^AXM-123): schema and commands shared by the
 * browser editor and the server converter. It has no Markdown rule of its own, so
 * tiptap-markdown writes it as its HTML span (html mode). The browser adds the
 * autocomplete and the input rule.
 */
export const IssueReferenceNode = Node.create<IssueReferenceOptions>({
  name: 'issueReference',
  group: 'inline',
  inline: true,
  selectable: false,
  atom: true,

  addOptions() {
    return {
      HTMLAttributes: {},
      projectId: null,
      instanceId: null,
    };
  },

  addAttributes() {
    return {
      key: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-issue-key'),
        renderHTML: (attrs) => ({ 'data-issue-key': attrs.key }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-issue-key]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { class: 'issue-ref' }),
      `${HTMLAttributes['data-issue-key']}`,
    ];
  },

  addCommands() {
    return {
      insertIssueReference:
        (key: string) =>
        ({ commands }) => {
          return commands.insertContent({ type: this.name, attrs: { key } });
        },
    };
  },
});
