import { Extension } from '@tiptap/core';

const INLINE_TAGS = new Set([
  'A',
  'B',
  'CODE',
  'DEL',
  'EM',
  'I',
  'IMG',
  'KBD',
  'MARK',
  'S',
  'SPAN',
  'STRIKE',
  'STRONG',
  'SUB',
  'SUP',
  'U',
]);

/**
 * Parse fix: a soft line break right after an inline element (`a *x*\nb`, a raw tag,
 * a footnote reference) becomes a space.
 *
 * tiptap-markdown strips a newline that starts the text after any element, meant
 * for the newlines markdown-it puts after block tags. After an inline element that
 * newline is the soft break, and stripping it merged the words (`a *x*b`). A space
 * is what every other soft break turns into, so the result is stable.
 */
export const SoftBreakAfterInline = Extension.create({
  name: 'softBreakAfterInline',

  addStorage() {
    return {
      markdown: {
        parse: {
          updateDOM(element: HTMLElement) {
            element.querySelectorAll('*').forEach((el) => {
              if (!INLINE_TAGS.has(el.tagName) || el.closest('pre')) return;
              const next = el.nextSibling;
              if (next?.nodeType === 3 && next.textContent?.startsWith('\n')) {
                next.textContent = ` ${next.textContent.slice(1)}`;
              }
            });
          },
        },
      },
    };
  },
});
