import { Extension } from '@tiptap/core';
import { defaultSelectionBuilder, yCursorPlugin } from '@tiptap/y-tiptap';
import type { WebsocketProvider } from 'y-websocket';

interface CursorUser {
  name: string;
  color: string;
}

interface CollaborationCursorOptions {
  provider: WebsocketProvider;
  user: CursorUser;
}

/**
 * Shares remote cursors and selections via the Yjs awareness protocol.
 *
 * `@tiptap/extension-collaboration-cursor` builds its plugin from `y-prosemirror`, while
 * `@tiptap/extension-collaboration` uses `@tiptap/y-tiptap`. The two have separate sync plugin
 * keys, so the cursor plugin could not find the sync state and crashed the editor on mount
 * ("Cannot read properties of undefined (reading 'doc')"). This builds the same plugin from
 * `@tiptap/y-tiptap` so both share one sync plugin key.
 */
export const CollaborationCursorExtension = Extension.create<CollaborationCursorOptions>({
  name: 'collaborationCursor',

  addOptions() {
    return {
      provider: null as unknown as WebsocketProvider,
      user: { name: 'Anonymous', color: '#3b82f6' },
    };
  },

  addProseMirrorPlugins() {
    const { awareness } = this.options.provider;
    awareness.setLocalStateField('user', this.options.user);

    return [
      yCursorPlugin(awareness, {
        cursorBuilder: (user: CursorUser) => {
          const cursor = document.createElement('span');
          cursor.classList.add('collaboration-cursor__caret');
          cursor.setAttribute('style', `border-color: ${user.color}`);

          const label = document.createElement('div');
          label.classList.add('collaboration-cursor__label');
          label.setAttribute('style', `background-color: ${user.color}`);
          label.appendChild(document.createTextNode(user.name));

          cursor.appendChild(label);
          return cursor;
        },
        selectionBuilder: defaultSelectionBuilder,
      }),
    ];
  },
});
