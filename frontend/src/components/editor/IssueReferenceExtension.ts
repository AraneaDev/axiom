import { Node, mergeAttributes, InputRule } from '@tiptap/core';

export interface IssueReferenceOptions {
  HTMLAttributes: Record<string, string>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    issueReference: {
      insertIssueReference: (key: string) => ReturnType;
    };
  }
}

export const IssueReferenceExtension = Node.create<IssueReferenceOptions>({
  name: 'issueReference',
  group: 'inline',
  inline: true,
  selectable: false,
  atom: true,

  addOptions() {
    return { HTMLAttributes: {} };
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

  addInputRules() {
    return [
      new InputRule({
        find: /#([A-Z]+-\d+)\s$/,
        handler: ({ state, range, match }) => {
          const key = match[1];
          const { tr } = state;
          tr.replaceWith(range.from, range.to, state.schema.nodes.issueReference.create({ key }));
        },
      }),
    ];
  },
});
