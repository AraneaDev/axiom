/**
 * TipTap editor with Yjs collaboration and cursor sharing.
 * Uses the same toolbar and styling as MarkdownEditor,
 * but backed by a shared Yjs document instead of local state.
 */

import Collaboration from '@tiptap/extension-collaboration';
import { useEditor, EditorContent } from '@tiptap/react';
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  Code,
  Minus,
  Link as LinkIcon,
  ImageIcon,
  Table as TableIcon,
  MessageSquareWarning,
  ListChecks,
  FoldVertical,
  ListTree,
  Lock,
} from 'lucide-react';
import { useEffect, useLayoutEffect, useState } from 'react';
import type { WebsocketProvider } from 'y-websocket';
import type * as Y from 'yjs';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { cn } from '@/lib/utils';

import { CollaborationCursorExtension } from './CollaborationCursorExtension';
import { buildEditorExtensions } from './editor-extensions';
import { editorMarkdown } from './editor-markdown';
import { editorProjectIds, nextEditorInstanceId } from './editor-state';

interface CollaborativeEditorProps {
  ydoc: Y.Doc;
  provider: WebsocketProvider;
  fragmentName: string;
  onChange?: (md: string) => void;
  placeholder?: string;
  projectId?: string;
  /** Set while a merge swaps the content: the editor is read-only and shows "Merging..." */
  locked?: { byName: string } | null;
  /** Whether the user may edit; viewers get a read-only editor */
  canEdit?: boolean;
}

interface ToolbarButtonProps {
  onClick: () => void;
  active?: boolean;
  children: React.ReactNode;
  title?: string;
}

function ToolbarButton({ onClick, active, children, title }: ToolbarButtonProps) {
  return (
    <Button
      variant="ghost"
      size="xs"
      onClick={onClick}
      title={title}
      className={cn(
        'p-1.5',
        active
          ? 'bg-primary/15 text-primary'
          : 'text-text-secondary hover:bg-surface-tertiary hover:text-text',
      )}
    >
      {children}
    </Button>
  );
}

function ToolbarDivider() {
  return <div className="w-px h-5 bg-border mx-0.5" />;
}

/**
 * Collaborative TipTap editor using Yjs CRDT for real-time sync.
 * @param root0
 * @param root0.ydoc
 * @param root0.provider
 * @param root0.fragmentName
 * @param root0.onChange
 * @param root0.placeholder
 * @param root0.projectId
 * @param root0.locked
 * @param root0.canEdit
 */
export function CollaborativeEditor({
  ydoc,
  provider,
  fragmentName,
  onChange,
  placeholder,
  projectId,
  locked = null,
  canEdit = true,
}: CollaborativeEditorProps) {
  const [instanceId] = useState(() => nextEditorInstanceId());

  useEffect(() => {
    editorProjectIds[instanceId] = projectId ?? null;
    return () => {
      delete editorProjectIds[instanceId];
    };
  }, [instanceId, projectId]);

  const editor = useEditor({
    extensions: [
      ...buildEditorExtensions({ placeholder, projectId, instanceId }),
      // Yjs collaboration
      Collaboration.configure({
        document: ydoc,
        field: fragmentName,
      }),
      // Cursor sharing
      CollaborationCursorExtension.configure({
        provider,
        user: provider.awareness.getLocalState()?.user ?? {
          name: 'Anonymous',
          color: '#3b82f6',
        },
      }),
    ],
    onUpdate: ({ editor: e }) => {
      if (onChange) {
        const md = editorMarkdown(e);
        // The initial Yjs sync fires an update while the editor is created during
        // render; defer so the parent's state update does not run inside that render.
        if (md !== null) queueMicrotask(() => onChange(md));
      }
    },
    editorProps: {
      attributes: {
        class:
          'tiptap-editor prose prose-sm max-w-none dark:prose-invert focus:outline-none min-h-[300px] px-4 py-3',
      },
    },
  });

  // Read-only during a merge lock; a layout effect, so it applies in the same render as the lock
  const editable = !locked && canEdit;
  useLayoutEffect(() => {
    if (editor && editor.isEditable !== editable) editor.setEditable(editable, false);
  }, [editor, editable]);

  // Clean up editor on unmount
  useEffect(() => {
    return () => {
      editor?.destroy();
    };
  }, [editor]);

  if (!editor) return null;

  const ic = 'h-4 w-4';

  function insertLink() {
    const url = window.prompt('URL:');
    if (url) {
      editor!.chain().focus().setLink({ href: url }).run();
    }
  }

  function insertImage() {
    const url = window.prompt('Image URL:');
    if (url) {
      editor!.chain().focus().setImage({ src: url }).run();
    }
  }

  function insertTable() {
    editor!.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
  }

  return (
    <Card className="relative overflow-hidden" aria-busy={!!locked}>
      {/* Toolbar (not for viewers; covered by the overlay during a merge) */}
      <div
        hidden={!canEdit}
        className="flex items-center gap-0.5 px-2 py-1.5 border-b border-border bg-surface-secondary flex-wrap"
      >
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBold().run()}
          active={editor.isActive('bold')}
          title="Bold"
        >
          <Bold className={ic} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleItalic().run()}
          active={editor.isActive('italic')}
          title="Italic"
        >
          <Italic className={ic} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          active={editor.isActive('underline')}
          title="Underline"
        >
          <UnderlineIcon className={ic} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleStrike().run()}
          active={editor.isActive('strike')}
          title="Strikethrough"
        >
          <Strikethrough className={ic} />
        </ToolbarButton>

        <ToolbarDivider />

        <ToolbarButton
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          active={editor.isActive('heading', { level: 1 })}
          title="Heading 1"
        >
          <Heading1 className={ic} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          active={editor.isActive('heading', { level: 2 })}
          title="Heading 2"
        >
          <Heading2 className={ic} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          active={editor.isActive('heading', { level: 3 })}
          title="Heading 3"
        >
          <Heading3 className={ic} />
        </ToolbarButton>

        <ToolbarDivider />

        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          active={editor.isActive('bulletList')}
          title="Bullet List"
        >
          <List className={ic} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          active={editor.isActive('orderedList')}
          title="Ordered List"
        >
          <ListOrdered className={ic} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          active={editor.isActive('blockquote')}
          title="Blockquote"
        >
          <Quote className={ic} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
          active={editor.isActive('codeBlock')}
          title="Code Block"
        >
          <Code className={ic} />
        </ToolbarButton>

        <ToolbarDivider />

        <ToolbarButton onClick={insertLink} active={editor.isActive('link')} title="Link">
          <LinkIcon className={ic} />
        </ToolbarButton>
        <ToolbarButton onClick={insertImage} title="Image">
          <ImageIcon className={ic} />
        </ToolbarButton>
        <ToolbarButton onClick={insertTable} title="Table">
          <TableIcon className={ic} />
        </ToolbarButton>
        <ToolbarDivider />
        <ToolbarButton
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
          title="Horizontal Rule"
        >
          <Minus className={ic} />
        </ToolbarButton>
        <ToolbarDivider />
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleTaskList().run()}
          active={editor.isActive('taskList')}
          title="Task List"
        >
          <ListChecks className={ic} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().setCallout({ type: 'info' }).run()}
          active={editor.isActive('callout')}
          title="Callout"
        >
          <MessageSquareWarning className={ic} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().setCollapsible().run()}
          active={editor.isActive('collapsible')}
          title="Collapsible Section"
        >
          <FoldVertical className={ic} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().insertTableOfContents().run()}
          title="Table of Contents"
        >
          <ListTree className={ic} />
        </ToolbarButton>
      </div>

      {/* Editor */}
      <EditorContent editor={editor} />
      {locked && (
        <div
          role="status"
          className="absolute inset-0 z-10 flex items-center justify-center bg-surface/70 backdrop-blur-[1px]"
        >
          <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-elevated px-4 py-2.5 text-sm shadow-sm">
            <Spinner className="h-4 w-4" />
            <span className="font-medium text-text">Merging…</span>
            {locked.byName && (
              <span className="flex items-center gap-1 text-text-secondary">
                <Lock className="h-3.5 w-3.5" /> {locked.byName} is applying a merge
              </span>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
