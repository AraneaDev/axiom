import Mention from '@tiptap/extension-mention';

/**
 * User mention inline node: schema and rendering shared by the browser editor and
 * the server converter. It has no Markdown rule of its own, so tiptap-markdown
 * writes it as its HTML span (html mode): `<span class="mention">@Name</span>`.
 * The browser adds the user autocomplete.
 *
 * That span carries no `data-type`, so the stock parse rule never matched it and a
 * mention came back as plain text. The extra rule reads it back as a mention with
 * the same label, so the Markdown round trip is identical.
 */
export const MentionNode = Mention.extend({
  parseHTML() {
    return [
      ...(this.parent?.() ?? []),
      {
        tag: 'span.mention',
        getAttrs: (element: HTMLElement) => ({
          id: null,
          label: (element.textContent ?? '').replace(/^@/, ''),
        }),
      },
    ];
  },
}).configure({
  HTMLAttributes: { class: 'mention' },
  renderText({ node }) {
    return `@${node.attrs.label ?? node.attrs.id}`;
  },
  renderHTML({ node }) {
    return ['span', { class: 'mention' }, `@${node.attrs.label ?? node.attrs.id}`];
  },
});
