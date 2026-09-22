import { Node, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { ReactNodeViewRenderer } from '@tiptap/react';

import { get } from '@/api/client';

import SmartLinkNode from './SmartLinkNode';

interface SmartLinkPreview {
  type: string;
  title: string;
  key: string;
  status: string;
  icon: string;
  url: string;
}

/**
 * TipTap extension that renders rich inline previews when Axiom URLs are pasted.
 * Matches issue, PR, and wiki page URLs and replaces them with a smartLink node
 * showing icon, key, title, and status.
 */
export const SmartLinkExtension = Node.create({
  name: 'smartLink',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return {
      url: { default: null },
      type: { default: null },
      title: { default: null },
      key: { default: null },
      status: { default: null },
      icon: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-smart-link]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, { 'data-smart-link': '', class: 'smart-link' }),
      `${HTMLAttributes.key ?? ''} ${HTMLAttributes.title ?? ''}`,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(SmartLinkNode);
  },

  addProseMirrorPlugins() {
    const nodeType = this.type;

    return [
      new Plugin({
        key: new PluginKey('smartLinkPaste'),
        props: {
          handlePaste(view, event) {
            const clipboardData = event.clipboardData;
            if (!clipboardData) return false;

            const text = clipboardData.getData('text/plain').trim();
            if (!text) return false;

            // Only handle URLs that look like Axiom paths
            const axiomPattern =
              /^(https?:\/\/[^/]+)?\/[^/]+\/[^/]+\/(([^/]+\/issues\/\d+)|(repos\/[^/]+\/pulls\/\d+)|(wiki\/[^/]+\/[^/]+))$/;
            if (!axiomPattern.test(text)) return false;

            // Resolve the link asynchronously
            get<SmartLinkPreview>(`/links/resolve-link?url=${encodeURIComponent(text)}`)
              .then((preview) => {
                const { state: currentState, dispatch: currentDispatch } = view;
                const currentTr = currentState.tr;

                const node = nodeType.create({
                  url: preview.url,
                  type: preview.type,
                  title: preview.title,
                  key: preview.key,
                  status: preview.status,
                  icon: preview.icon,
                });

                currentTr.replaceSelectionWith(node);
                // Add a space after the smart link
                currentTr.insertText(' ');
                currentDispatch(currentTr);
              })
              .catch(() => {
                // If resolution fails, insert as plain text
                const { state: currentState, dispatch: currentDispatch } = view;
                const currentTr = currentState.tr;
                currentTr.insertText(text);
                currentDispatch(currentTr);
              });

            // Prevent default paste
            event.preventDefault();
            // Return true to indicate we handled it; the async resolution will
            // insert content once the API responds.
            return true;
          },
        },
      }),
    ];
  },
});
