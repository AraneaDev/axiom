/**
 * Shared mutable store for per-editor-instance projectId values.
 * Avoids React ref restrictions while letting TipTap extensions
 * read the latest projectId dynamically on each keystroke.
 */
export const editorProjectIds: Record<number, string | null> = {};

let counter = 0;

/** Allocate a unique instance ID for a MarkdownEditor. */
export function nextEditorInstanceId(): number {
  return ++counter;
}
