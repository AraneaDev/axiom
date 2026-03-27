/**
 * TipTap editor with Yjs collaboration and cursor sharing.
 * Uses the same toolbar and styling as MarkdownEditor,
 * but backed by a shared Yjs document instead of local state.
 */

import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCursor from '@tiptap/extension-collaboration-cursor';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import { Table } from '@tiptap/extension-table';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import TableRow from '@tiptap/extension-table-row';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import Underline from '@tiptap/extension-underline';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { common, createLowlight } from 'lowlight';
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
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Markdown } from 'tiptap-markdown';
import type { WebsocketProvider } from 'y-websocket';
import type * as Y from 'yjs';

import { CalloutExtension } from './CalloutExtension';
import { CollapsibleExtension } from './CollapsibleExtension';
import { editorProjectIds, nextEditorInstanceId } from './editor-state';
import { IssueReferenceExtension } from './IssueReferenceExtension';
import { MentionExtension } from './MentionExtension';
import { SlashCommandExtension } from './SlashCommandExtension';
import { TableOfContentsExtension } from './TableOfContentsExtension';

import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

const lowlight = createLowlight(common);

interface CollaborativeEditorProps {
  ydoc: Y.Doc;
  provider: WebsocketProvider;
  fragmentName: string;
  onChange?: (md: string) => void;
  placeholder?: string;
  projectId?: string;
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
 */
export function CollaborativeEditor({
  ydoc,
  provider,
  fragmentName,
  onChange,
  placeholder,
  projectId,
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
      StarterKit.configure({
        codeBlock: false,
        heading: { levels: [1, 2, 3] },
        underline: false,
        link: false,
      }),
      Underline,
      Link.configure({ openOnClick: false, HTMLAttributes: { class: 'text-primary underline' } }),
      Image,
      Table.configure({ resizable: false }),
      TableRow,
      TableCell,
      TableHeader,
      Placeholder.configure({ placeholder: placeholder || 'Write something...' }),
      CodeBlockLowlight.configure({ lowlight }),
      Markdown.configure({
        html: true,
        transformPastedText: true,
        transformCopiedText: true,
      }),
      MentionExtension,
      IssueReferenceExtension.configure({
        projectId: projectId ?? null,
        instanceId,
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      CalloutExtension,
      CollapsibleExtension,
      TableOfContentsExtension,
      SlashCommandExtension,
      // Yjs collaboration
      Collaboration.configure({
        document: ydoc,
        field: fragmentName,
      }),
      // Cursor sharing
      CollaborationCursor.configure({
        provider,
        user: provider.awareness.getLocalState()?.user ?? {
          name: 'Anonymous',
          color: '#3b82f6',
        },
      }),
    ],
    onUpdate: ({ editor: e }) => {
      if (onChange) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tiptap-markdown storage type not exported
        const md = (e.storage as any).markdown.getMarkdown();
        onChange(md);
      }
    },
    editorProps: {
      attributes: {
        class:
          'tiptap-editor prose prose-sm max-w-none dark:prose-invert focus:outline-none min-h-[300px] px-4 py-3',
      },
    },
  });

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
    <div className="rounded-lg border border-border bg-surface overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-border bg-surface-secondary flex-wrap">
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
    </div>
  );
}
