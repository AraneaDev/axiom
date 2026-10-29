/**
 * Headless Markdown converter built on the shared editor schema.
 *
 * Parsing and serializing go through the same tiptap-markdown parser and serializer
 * the browser editor uses, driven by a headless TipTap editor (no view). It needs a
 * DOM (`DOMParser`, `document`): the browser and jsdom provide one, and the server
 * entry installs happy-dom globals before this module is used.
 *
 * Yjs conversion uses `@tiptap/y-tiptap`, the binding `@tiptap/extension-collaboration`
 * uses in the browser, so the server writes exactly the structure the editor reads.
 */

import { Editor, createDocument, type JSONContent } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { prosemirrorJSONToYXmlFragment, yXmlFragmentToProseMirrorRootNode } from '@tiptap/y-tiptap';
import type * as Y from 'yjs';

import { getSchemaExtensions } from './schema-extensions';

interface MarkdownStorage {
  parser: { parse(content: string): string };
  serializer: { serialize(doc: PMNode): string };
}

let editor: Editor | null = null;

function getEditor(): Editor {
  if (!editor) {
    editor = new Editor({ element: null, extensions: getSchemaExtensions() });
  }
  return editor;
}

function markdownStorage(e: Editor): MarkdownStorage {
  return (e.storage as unknown as { markdown: MarkdownStorage }).markdown;
}

function markdownToDoc(md: string): PMNode {
  const e = getEditor();
  const html = markdownStorage(e).parser.parse(md);
  return createDocument(html, e.schema, e.options.parseOptions);
}

function docToMarkdown(doc: PMNode): string {
  return markdownStorage(getEditor()).serializer.serialize(doc);
}

/**
 * Parse Markdown into ProseMirror JSON, as the editor would load it.
 * @param md - Markdown source.
 * @returns The document as ProseMirror JSON.
 */
export function markdownToProseMirrorJSON(md: string): JSONContent {
  return markdownToDoc(md).toJSON() as JSONContent;
}

/**
 * Serialize ProseMirror JSON to Markdown, as the editor would save it.
 * @param doc - A `doc` node as ProseMirror JSON.
 * @returns The Markdown.
 */
export function proseMirrorJSONToMarkdown(doc: JSONContent): string {
  return docToMarkdown(getEditor().schema.nodeFromJSON(doc));
}

/**
 * Replace the content of a Yjs XML fragment with the parsed Markdown.
 * The fragment must belong to a `Y.Doc`; the update runs in one transaction.
 * @param md - Markdown source.
 * @param fragment - Target fragment, for example `doc.getXmlFragment('default')`.
 */
export function markdownToYFragment(md: string, fragment: Y.XmlFragment): void {
  prosemirrorJSONToYXmlFragment(getEditor().schema, markdownToDoc(md).toJSON(), fragment);
}

/**
 * Serialize a Yjs XML fragment, as written by the collaborative editor, to Markdown.
 * @param fragment - Source fragment.
 * @returns The Markdown.
 */
export function yFragmentToMarkdown(fragment: Y.XmlFragment): string {
  return docToMarkdown(yXmlFragmentToProseMirrorRootNode(fragment, getEditor().schema));
}

/**
 * Run Markdown through one parse and serialize, the normalisation the editor
 * applies on its first save.
 * @param md - Markdown source.
 * @returns The normalised Markdown.
 */
export function normalizeMarkdown(md: string): string {
  return docToMarkdown(markdownToDoc(md));
}
