import type { AnyExtension } from '@tiptap/core';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import Placeholder from '@tiptap/extension-placeholder';
import { common, createLowlight } from 'lowlight';

import { getSchemaExtensions } from '@/editor-core/schema-extensions';

import { CalloutExtension } from './CalloutExtension';
import { CollapsibleExtension } from './CollapsibleExtension';
import { ImageExtension } from './ImageExtension';
import { IssueEmbedExtension } from './IssueEmbedExtension';
import { IssueReferenceExtension } from './IssueReferenceExtension';
import { MentionExtension } from './MentionExtension';
import { QueryEmbedExtension } from './QueryEmbedExtension';
import { SlashCommandExtension } from './SlashCommandExtension';
import { SmartLinkExtension } from './SmartLinkExtension';
import { TableOfContentsExtension } from './TableOfContentsExtension';

const lowlight = createLowlight(common);

interface EditorExtensionOptions {
  placeholder?: string;
  projectId?: string;
  instanceId: number;
  /** Offer the live query and dashboard blocks, which only a wiki page renders */
  liveBlocks?: boolean;
}

/**
 * The browser editor's extensions: the shared schema from the editor core, with
 * each node swapped for its interactive variant (node views, autocomplete, paste
 * handling, syntax highlighting) and the browser-only extensions added in the
 * positions they always had. Shared by the wiki and issue editors; the wiki editor
 * appends its collaboration extensions.
 * @param opts - Per-editor options.
 * @param opts.placeholder - Placeholder text for an empty editor.
 * @param opts.projectId - Project used by the issue reference autocomplete.
 * @param opts.instanceId - Editor instance key for the shared projectId store.
 * @param opts.liveBlocks - Offer the live query and dashboard blocks in the slash menu.
 * @returns The extension list.
 */
export function buildEditorExtensions({
  placeholder,
  projectId,
  instanceId,
  liveBlocks,
}: EditorExtensionOptions): AnyExtension[] {
  const browserVariants: Record<string, AnyExtension> = {
    codeBlock: CodeBlockLowlight.configure({ lowlight }),
    mention: MentionExtension,
    issueReference: IssueReferenceExtension.configure({
      projectId: projectId ?? null,
      instanceId,
    }),
    callout: CalloutExtension,
    collapsible: CollapsibleExtension,
    tableOfContents: TableOfContentsExtension,
    smartLink: SmartLinkExtension,
    issueEmbed: IssueEmbedExtension,
    queryEmbed: QueryEmbedExtension,
    image: ImageExtension,
  };

  const extensions: AnyExtension[] = [];
  for (const extension of getSchemaExtensions({ projectId })) {
    if (extension.name === 'codeBlock') {
      extensions.push(Placeholder.configure({ placeholder: placeholder || 'Write something...' }));
    }
    if (extension.name === 'smartLink') {
      extensions.push(SlashCommandExtension.configure({ liveBlocks: liveBlocks ?? false }));
    }
    extensions.push(browserVariants[extension.name] ?? extension);
  }
  return extensions;
}
