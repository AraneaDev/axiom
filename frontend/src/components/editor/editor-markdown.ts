import type { Editor } from '@tiptap/core';

/**
 * The editor's document as Markdown, from tiptap-markdown's storage. Null for a destroyed
 * editor: TipTap empties its storage on destroy, and a React effect can still hold one.
 * @param editor - A TipTap editor with the Markdown extension
 * @returns The Markdown, or null when the editor has no Markdown storage
 */
export function editorMarkdown(editor: Editor): string | null {
  const storage = (editor.storage as unknown as { markdown?: { getMarkdown(): string } }).markdown;
  return storage ? storage.getMarkdown() : null;
}
