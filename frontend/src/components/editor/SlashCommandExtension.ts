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
  ImageIcon,
  GitBranch,
} from 'lucide-react';
import tippy, { type Instance as TippyInstance } from 'tippy.js';

import SlashCommandMenu, {
  type SlashCommandItem,
  type SlashCommandMenuRef,
} from './SlashCommandMenu';

interface CommandDefinition {
  name: string;
  category: string;
  icon: SlashCommandItem['icon'];
  action: (editor: Editor) => void;
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
  // Media
  {
    name: 'Image',
    category: 'Media',
    icon: ImageIcon,
    action: (editor) => {
      const url = window.prompt('Image URL:');
      if (url) {
        editor.chain().focus().setImage({ src: url }).run();
      }
    },
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
 * TipTap extension providing a slash command menu.
 * Type "/" to open a filterable command palette for inserting block types.
 */
export const SlashCommandExtension = Extension.create({
  name: 'slashCommand',

  addOptions() {
    return {
      suggestion: {
        char: '/',
        startOfLine: false,
        items: ({ query }: { query: string }): CommandDefinition[] => {
          if (!query) return commands;
          const lower = query.toLowerCase();
          return commands.filter((cmd) => cmd.name.toLowerCase().includes(lower));
        },
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
      }),
    ];
  },
});
