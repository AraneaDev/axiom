import { ReactRenderer } from '@tiptap/react';
import Mention from '@tiptap/extension-mention';
import tippy, { type Instance as TippyInstance } from 'tippy.js';
import MentionList, { type MentionListRef } from './MentionList';
import { get } from '@/api/client';

interface UserItem {
  id: string;
  displayName: string;
  username: string;
}

export const MentionExtension = Mention.configure({
  HTMLAttributes: { class: 'mention' },
  renderLabel({ node }) {
    return `@${node.attrs.label ?? node.attrs.id}`;
  },
  suggestion: {
    items: async ({ query }: { query: string }): Promise<UserItem[]> => {
      if (!query || query.length < 1) return [];
      try {
        const data = await get<{ users: UserItem[] }>(`/users?q=${encodeURIComponent(query)}&limit=8`);
        return data.users ?? [];
      } catch {
        return [];
      }
    },
    render: () => {
      let component: ReactRenderer<MentionListRef> | null = null;
      let popup: TippyInstance[] | null = null;

      return {
        onStart: (props: Record<string, unknown>) => {
          component = new ReactRenderer(MentionList, { props, editor: props.editor as never });
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
        onUpdate: (props: Record<string, unknown>) => {
          component?.updateProps(props);
          if (popup?.[0]) {
            popup[0].setProps({ getReferenceClientRect: props.clientRect as () => DOMRect });
          }
        },
        onKeyDown: (props: { event: KeyboardEvent }) => {
          if (props.event.key === 'Escape') { popup?.[0]?.hide(); return true; }
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
