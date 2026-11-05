import { Extension } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import { ReactRenderer } from '@tiptap/react';
import Suggestion, { type SuggestionProps } from '@tiptap/suggestion';
import {
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  ListChecks,
  MessageSquareWarning,
  Code,
  FoldVertical,
  Table2,
  ListTree,
  Quote,
  Minus,
  Upload,
  Link,
  GitBranch,
  CircleDot,
  LayoutDashboard,
  ListFilter,
} from 'lucide-react';
import tippy, { type Instance as TippyInstance } from 'tippy.js';

import { insertImageFromUrl, pickAndInsertImage } from './image-upload';
import { QueryEmbedPicker, type QueryEmbedSource } from './QueryEmbedPicker';
import SlashCommandMenu, {
  type SlashCommandItem,
  type SlashCommandMenuRef,
} from './SlashCommandMenu';

interface CommandDefinition {
  name: string;
  category: string;
  icon: SlashCommandItem['icon'];
  action: (editor: Editor) => void;
  /** A live block: offered only where it will render */
  liveBlock?: boolean;
}

/**
 * Ask what a live block should show, and put it where the slash was. Rendered through the editor,
 * so the form has the page's providers.
 * @param editor - The editor
 * @param source - Which of the form's sources to start on
 */
function pickQueryEmbed(editor: Editor, source: QueryEmbedSource): void {
  const renderer = new ReactRenderer(QueryEmbedPicker, {
    editor,
    props: {
      source,
      onPick: (target: string) => {
        renderer.destroy();
        editor.chain().focus().setQueryEmbed({ target }).run();
      },
      onClose: () => {
        renderer.destroy();
        editor.commands.focus();
      },
    },
  });
}

const commands: CommandDefinition[] = [
  // Text
  {
    name: 'Heading 1',
    category: 'Text',
    icon: Heading1,
    action: (editor) => editor.chain().focus().setHeading({ level: 1 }).run(),
  },
  {
    name: 'Heading 2',
    category: 'Text',
    icon: Heading2,
    action: (editor) => editor.chain().focus().setHeading({ level: 2 }).run(),
  },
  {
    name: 'Heading 3',
    category: 'Text',
    icon: Heading3,
    action: (editor) => editor.chain().focus().setHeading({ level: 3 }).run(),
  },
  {
    name: 'Blockquote',
    category: 'Text',
    icon: Quote,
    action: (editor) => editor.chain().focus().toggleBlockquote().run(),
  },
  // Lists
  {
    name: 'Bullet List',
    category: 'Lists',
    icon: List,
    action: (editor) => editor.chain().focus().toggleBulletList().run(),
  },
  {
    name: 'Numbered List',
    category: 'Lists',
    icon: ListOrdered,
    action: (editor) => editor.chain().focus().toggleOrderedList().run(),
  },
  {
    name: 'Task List',
    category: 'Lists',
    icon: ListChecks,
    action: (editor) => editor.chain().focus().toggleTaskList().run(),
  },
  // Blocks
  {
    name: 'Callout',
    category: 'Blocks',
    icon: MessageSquareWarning,
    action: (editor) => editor.chain().focus().setCallout({ type: 'info' }).run(),
  },
  {
    name: 'Code Block',
    category: 'Blocks',
    icon: Code,
    action: (editor) => editor.chain().focus().toggleCodeBlock().run(),
  },
  {
    name: 'Collapsible',
    category: 'Blocks',
    icon: FoldVertical,
    action: (editor) => editor.chain().focus().setCollapsible().run(),
  },
  {
    name: 'Table',
    category: 'Blocks',
    icon: Table2,
    action: (editor) =>
      editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  {
    name: 'Table of Contents',
    category: 'Blocks',
    icon: ListTree,
    action: (editor) => editor.chain().focus().insertTableOfContents().run(),
  },
  {
    name: 'Divider',
    category: 'Blocks',
    icon: Minus,
    action: (editor) => editor.chain().focus().setHorizontalRule().run(),
  },
  {
    name: 'Issue Embed',
    category: 'Blocks',
    icon: CircleDot,
    action: (editor) => {
      const key = window.prompt('Issue key (e.g. AXM-123):');
      if (key) {
        editor.chain().focus().setIssueEmbed({ issueKey: key.trim().toUpperCase() }).run();
      }
    },
  },
  {
    name: 'Dashboard',
    category: 'Blocks',
    icon: LayoutDashboard,
    liveBlock: true,
    action: (editor) => pickQueryEmbed(editor, 'dashboard'),
  },
  {
    name: 'Query',
    category: 'Blocks',
    icon: ListFilter,
    liveBlock: true,
    action: (editor) => pickQueryEmbed(editor, 'saved'),
  },
  // Media
  {
    name: 'Image: Upload file',
    category: 'Media',
    icon: Upload,
    action: (editor) => pickAndInsertImage(editor),
  },
  {
    name: 'Image: Image URL',
    category: 'Media',
    icon: Link,
    action: (editor) => insertImageFromUrl(editor),
  },
  {
    name: 'Mermaid Diagram',
    category: 'Media',
    icon: GitBranch,
    action: (editor) => {
      editor
        .chain()
        .focus()
        .insertContent({
          type: 'codeBlock',
          attrs: { language: 'mermaid' },
          content: [{ type: 'text', text: 'graph TD\n  A-->B' }],
        })
        .run();
    },
  },
];

/**
 * The commands to offer.
 * @param query - What was typed after the slash
 * @param liveBlocks - Whether this editor's document renders live blocks
 * @returns The matching commands
 */
export function slashCommandsFor(query: string, liveBlocks: boolean): CommandDefinition[] {
  const lower = query.toLowerCase();
  return commands.filter(
    (cmd) => (liveBlocks || !cmd.liveBlock) && cmd.name.toLowerCase().includes(lower),
  );
}

/**
 * TipTap extension providing a slash command menu.
 * Type "/" to open a filterable command palette for inserting block types.
 */
export const SlashCommandExtension = Extension.create({
  name: 'slashCommand',

  addOptions() {
    return {
      liveBlocks: false,
      suggestion: {
        char: '/',
        startOfLine: false,
        render: () => {
          let component: ReactRenderer<SlashCommandMenuRef> | null = null;
          let popup: TippyInstance[] | null = null;

          return {
            onStart: (props: SuggestionProps<CommandDefinition>) => {
              const editorRef = props.editor;
              const mappedItems: SlashCommandItem[] = props.items.map((cmd) => ({
                ...cmd,
                action: () => cmd.action(editorRef),
              }));

              component = new ReactRenderer(SlashCommandMenu, {
                props: { ...props, items: mappedItems },
                editor: editorRef,
              });

              popup = tippy('body', {
                getReferenceClientRect: props.clientRect as () => DOMRect,
                appendTo: () => document.body,
                content: component.element,
                showOnCreate: true,
                interactive: true,
                trigger: 'manual',
                placement: 'bottom-start',
              });
            },
            onUpdate: (props: SuggestionProps<CommandDefinition>) => {
              const editorRef = props.editor;
              const mappedItems: SlashCommandItem[] = props.items.map((cmd) => ({
                ...cmd,
                action: () => cmd.action(editorRef),
              }));

              component?.updateProps({ ...props, items: mappedItems });
              if (popup?.[0]) {
                popup[0].setProps({
                  getReferenceClientRect: props.clientRect as () => DOMRect,
                });
              }
            },
            onKeyDown: (props: { event: KeyboardEvent }) => {
              if (props.event.key === 'Escape') {
                popup?.[0]?.hide();
                return true;
              }
              return component?.ref?.onKeyDown(props) ?? false;
            },
            onExit: () => {
              popup?.[0]?.destroy();
              component?.destroy();
              component = null;
              popup = null;
            },
          };
        },
        command: ({
          editor,
          range,
          props: cmd,
        }: {
          editor: Editor;
          range: { from: number; to: number };
          props: CommandDefinition;
        }) => {
          // Delete the slash command text first, then execute the command action
          editor.chain().focus().deleteRange(range).run();
          cmd.action(editor);
        },
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        pluginKey: new PluginKey('slashCommand'),
        ...this.options.suggestion,
        items: ({ query }: { query: string }) => slashCommandsFor(query, this.options.liveBlocks),
      }),
    ];
  },
});
