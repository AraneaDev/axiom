import Mention, { type MentionNodeAttrs } from '@tiptap/extension-mention';
import { ReactRenderer } from '@tiptap/react';
import type { SuggestionProps } from '@tiptap/suggestion';
import tippy, { type Instance as TippyInstance } from 'tippy.js';

import MentionList, { type MentionListRef } from './MentionList';

import { get } from '@/api/client';

interface UserItem {
  id: string;
  label: string;
  displayName: string;
  username: string;
}

/**
 * TipTap extension for @-mention user references.
 * Configured with suggestion-based autocomplete triggered by "@".
 * Searches users via the /users API and renders as styled mention nodes.
 */
export const MentionExtension = Mention.configure({
  HTMLAttributes: { class: 'mention' },
  renderLabel({ node }) {
    return `@${node.attrs.label ?? node.attrs.id}`;
  },
  suggestion: {
    items: async ({ query }: { query: string }): Promise<UserItem[]> => {
      if (!query || query.length < 1) return [];
      try {
        const data = await get<Array<{ id: string; displayName: string; username: string }>>(
          `/users/search?q=${encodeURIComponent(query)}&limit=8`,
        );
        if (!Array.isArray(data)) return [];
        return data.map((u) => ({
          id: u.username,
          label: u.displayName,
          displayName: u.displayName,
          username: u.username,
        }));
      } catch {
        return [];
      }
    },
    render: () => {
      let component: ReactRenderer<MentionListRef> | null = null;
      let popup: TippyInstance[] | null = null;

      return {
        onStart: (props: SuggestionProps<UserItem, MentionNodeAttrs>) => {
          component = new ReactRenderer(MentionList, { props, editor: props.editor });
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
        onUpdate: (props: SuggestionProps<UserItem, MentionNodeAttrs>) => {
          component?.updateProps(props);
          if (popup?.[0]) {
            popup[0].setProps({ getReferenceClientRect: props.clientRect as () => DOMRect });
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
  },
});
