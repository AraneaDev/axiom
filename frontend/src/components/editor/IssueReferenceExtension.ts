import { Node, mergeAttributes, InputRule } from '@tiptap/core';
import { ReactRenderer } from '@tiptap/react';
import Suggestion, { type SuggestionProps } from '@tiptap/suggestion';
import tippy, { type Instance as TippyInstance } from 'tippy.js';

import IssueReferenceSuggestionList, {
  type IssueReferenceItem,
  type IssueReferenceSuggestionListRef,
} from './IssueReferenceSuggestionList';

import { get } from '@/api/client';

export interface IssueReferenceOptions {
  HTMLAttributes: Record<string, string>;
  projectId: string | null;
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
    return {
      HTMLAttributes: {},
      projectId: null,
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

  addProseMirrorPlugins() {
    const projectId = this.options.projectId;

    return [
      Suggestion<IssueReferenceItem>({
        editor: this.editor,
        char: '#',
        allowSpaces: false,
        items: async ({ query }): Promise<IssueReferenceItem[]> => {
          if (!query || query.length < 1) return [];
          if (!projectId) return [];
          try {
            const data = await get<{ issues: IssueReferenceItem[] }>(
              `/projects/${projectId}/issues?q=${encodeURIComponent(query)}&limit=8`,
            );
            return (data.issues ?? []).map((issue) => ({
              id: issue.id,
              number: issue.number,
              title: issue.title,
              key: issue.key,
              type: issue.type,
              status: (issue as unknown as { column?: { name?: string } }).column?.name,
            }));
          } catch {
            return [];
          }
        },
        command: ({ editor, range, props }) => {
          editor
            .chain()
            .focus()
            .deleteRange(range)
            .insertContent([
              { type: 'issueReference', attrs: { key: props.key } },
              { type: 'text', text: ' ' },
            ])
            .run();
        },
        render: () => {
          let component: ReactRenderer<IssueReferenceSuggestionListRef> | null = null;
          let popup: TippyInstance[] | null = null;

          return {
            onStart: (props: SuggestionProps<IssueReferenceItem>) => {
              component = new ReactRenderer(IssueReferenceSuggestionList, {
                props,
                editor: props.editor,
              });
              popup = tippy('body', {
                getReferenceClientRect: props.clientRect as () => DOMRect,
                appendTo: () => document.body,
                content: component.element,
                showOnCreate: true,
                interactive: true,
                trigger: 'manual',
                placement: 'bottom-start',
              });
            },
            onUpdate: (props: SuggestionProps<IssueReferenceItem>) => {
              component?.updateProps(props);
              if (popup?.[0]) {
                popup[0].setProps({
                  getReferenceClientRect: props.clientRect as () => DOMRect,
                });
              }
            },
            onKeyDown: (props: { event: KeyboardEvent }) => {
              if (props.event.key === 'Escape') {
                popup?.[0]?.hide();
                return true;
              }
              return component?.ref?.onKeyDown(props) ?? false;
            },
            onExit: () => {
              popup?.[0]?.destroy();
              component?.destroy();
              component = null;
              popup = null;
            },
          };
        },
      }),
    ];
  },
});
