import { Node, mergeAttributes } from '@tiptap/core';

/**
 * Smart link inline node: schema shared by the browser editor and the server
 * converter. It has no Markdown rule of its own, so tiptap-markdown writes it as
 * its HTML span (html mode). The browser adds the node view and paste handling.
 */
export const SmartLinkNode = Node.create({
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
});
