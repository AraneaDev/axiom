import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import { describe, expect, it } from 'vitest';

import { editorMarkdown } from './editor-markdown';

describe('editorMarkdown', () => {
  it('returns the Markdown of a live editor and null once it is destroyed', () => {
    const editor = new Editor({ extensions: [StarterKit, Markdown], content: '# Title' });
    expect(editorMarkdown(editor)).toBe('# Title');
    editor.destroy();
    expect(editorMarkdown(editor)).toBeNull();
  });
});
