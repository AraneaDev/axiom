import { Node, mergeAttributes, InputRule } from '@tiptap/core';
import { ReactRenderer } from '@tiptap/react';
import Suggestion, { type SuggestionProps } from '@tiptap/suggestion';
import tippy, { type Instance as TippyInstance } from 'tippy.js';

import { editorProjectIds } from './editor-state';
import IssueReferenceSuggestionList, {
  type IssueReferenceItem,
  type IssueReferenceSuggestionListRef,
} from './IssueReferenceSuggestionList';

import { get } from '@/api/client';

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
 * TipTap extension for inline issue references (e.g. ^AXM-123).
 * Renders as an inline atom node with a data-issue-key attribute.
 * Provides suggestion-based autocomplete triggered by "^" and an input rule
 * that auto-converts "^PREFIX-123 " into a reference node.
 * Configure with projectId to enable autocomplete against the issues API.
 */
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

  addInputRules() {
    return [
      new InputRule({
        find: /\^([A-Z]+-\d+)\s$/,
        handler: ({ state, range, match }) => {
          const key = match[1];
          const { tr } = state;
          tr.replaceWith(range.from, range.to, state.schema.nodes.issueReference.create({ key }));
        },
      }),
    ];
  },

  addProseMirrorPlugins() {
    const instanceId = this.options.instanceId;
    const staticProjectId = this.options.projectId;

    return [
      Suggestion<IssueReferenceItem>({
        editor: this.editor,
        char: '^',
        allowSpaces: false,
        items: async ({ query }): Promise<IssueReferenceItem[]> => {
          // Read projectId dynamically from shared store, fall back to static option
          const currentProjectId =
            (instanceId != null ? editorProjectIds[instanceId] : null) ?? staticProjectId;
          try {
            let issues: IssueReferenceItem[] = [];
            if (currentProjectId) {
              // Scoped search within project -- show recent issues even with empty query
              const qParam = query ? `q=${encodeURIComponent(query)}&` : '';
              const data = await get<{ issues: IssueReferenceItem[] }>(
                `/projects/${currentProjectId}/issues?${qParam}limit=8`,
              );
              issues = data.issues ?? [];
            } else if (query && query.length >= 1) {
              // Global search -- requires at least 1 character
              const data = await get<Array<{ type: string; items: IssueReferenceItem[] }>>(
                `/search?q=${encodeURIComponent(query)}&type=issues&limit=8`,
              );
              const issueGroup = Array.isArray(data)
                ? data.find((r) => r.type === 'issues')
                : undefined;
              issues = issueGroup?.items ?? [];
            }
            return issues.map((issue) => {
              // Handle both project-scoped (has column.name) and search (has status string) formats
              const raw = issue as unknown as Record<string, unknown>;
              const status =
                (raw.status as string) ?? (raw.column as { name?: string } | undefined)?.name;
              return {
                id: issue.id,
                number: issue.number,
                title: issue.title,
                key: issue.key,
                type: issue.type,
                status,
              };
            });
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
