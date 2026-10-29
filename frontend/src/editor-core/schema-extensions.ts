import type { AnyExtension } from '@tiptap/core';
import CodeBlock from '@tiptap/extension-code-block';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import TableRow from '@tiptap/extension-table-row';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import Underline from '@tiptap/extension-underline';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';

import { CalloutNode } from './nodes/callout';
import { CodeNode } from './nodes/code';
import { CollapsibleNode } from './nodes/collapsible';
import { IssueEmbedNode } from './nodes/issue-embed';
import { IssueReferenceNode } from './nodes/issue-reference';
import {
  BulletListNode,
  ListItemFirstBlock,
  ListItemNode,
  OrderedListNode,
} from './nodes/list-item';
import { MentionNode } from './nodes/mention';
import { RawHtmlInlineMark, RawHtmlNode } from './nodes/raw-html';
import { SmartLinkNode } from './nodes/smart-link';
import { TableNode } from './nodes/table';
import { TableOfContentsNode } from './nodes/table-of-contents';

export interface SchemaExtensionOptions {
  /** Project used by the issue reference autocomplete (browser only). */
  projectId?: string;
}

/**
 * The editor's schema and Markdown rules, in the order the editors register them.
 *
 * This is the single definition shared by the browser editors and the server-side
 * Markdown converter. It carries no node views, no collaboration, no placeholder and
 * no slash menu. The browser swaps in its interactive variants by extension name
 * (see `components/editor/editor-extensions.ts`); those variants extend the nodes
 * here and never change their schema or Markdown output.
 *
 * Several nodes fix tiptap-markdown round trips that dropped or merged content (see
 * their files): the list nodes, `code`, `table`, `mention`, the raw passthrough
 * node `rawHtml` and mark `rawHtmlInline` (HTML, footnotes). Headings accept levels 1 to 6
 * so deeper headings in Markdown survive; the toolbar still offers 1 to 3. Images are
 * inline, as in Markdown: a block image split its paragraph and emptied table cells.
 *
 * `codeBlock` is the plain TipTap code block. The browser replaces it with the
 * lowlight variant, which has the same name, attributes and Markdown output.
 * @param opts - Options for extensions that take per-editor configuration.
 * @returns The extension list.
 */
export function getSchemaExtensions(opts: SchemaExtensionOptions = {}): AnyExtension[] {
  return [
    StarterKit.configure({
      codeBlock: false,
      heading: { levels: [1, 2, 3, 4, 5, 6] },
      underline: false,
      link: false,
      listItem: false,
      bulletList: false,
      orderedList: false,
      code: false,
    }),
    ListItemNode,
    BulletListNode,
    OrderedListNode,
    CodeNode,
    Underline,
    Link.configure({ openOnClick: false, HTMLAttributes: { class: 'text-primary underline' } }),
    Image.configure({ inline: true }),
    TableNode.configure({ resizable: false }),
    TableRow,
    TableCell,
    TableHeader,
    CodeBlock,
    Markdown.configure({
      html: true,
      transformPastedText: true,
      transformCopiedText: true,
    }),
    MentionNode,
    IssueReferenceNode.configure({ projectId: opts.projectId ?? null }),
    TaskList,
    TaskItem.configure({ nested: true }),
    CalloutNode,
    CollapsibleNode,
    TableOfContentsNode,
    SmartLinkNode,
    IssueEmbedNode,
    RawHtmlNode,
    RawHtmlInlineMark,
    // Last: its parse step must run after every other node's updateDOM
    ListItemFirstBlock,
  ];
}
