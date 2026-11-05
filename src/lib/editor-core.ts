/**
 * Backend access to the shared editor core: the wiki editor's schema and Markdown
 * rules, used to convert between Markdown and the collaborative editor's Yjs doc.
 *
 * The code lives in `frontend/src/editor-core/` and reaches the backend as a
 * CommonJS bundle, `dist-editor-core/editor-core.cjs`, built by
 * `scripts/build-editor-core.mjs` (`npm run build:editor-core`). The bundle keeps
 * `yjs` external, so fragments passed in must come from this process's `yjs`.
 *
 * Call `loadEditorCore()` once at startup (and in test setup); after that every
 * conversion is synchronous. The conversions also load the bundle on first use.
 */

import { createRequire } from 'module';
import path from 'path';

import type * as Y from 'yjs';

interface EditorCoreBundle {
  markdownToYFragment(md: string, fragment: Y.XmlFragment): void;
  yFragmentToMarkdown(fragment: Y.XmlFragment): string;
  normalizeMarkdown(md: string): string;
  mergeMarkdown(base: string, ours: string, theirs: string): MergeResult;
  queryEmbedsIn(md: string): string[];
  parseQueryEmbedTarget(target: string): QueryEmbedTarget | null;
}

/** What a live block in a page shows (see frontend/src/editor-core/nodes/query-embed.ts) */
export type QueryEmbedTarget =
  | { kind: 'dashboard'; id: string }
  | { kind: 'savedQuery'; id: string }
  | { kind: 'inline'; query: string };

/** A block-level three-way merge result (see frontend/src/editor-core/merge.ts) */
export interface MergeResult {
  /** The merged Markdown, or null when there are conflicts */
  merged: string | null;
  hunks: Array<
    | { kind: 'clean'; text: string }
    | { kind: 'conflict'; id: string; base: string; ours: string; theirs: string }
  >;
}

/** From `src/lib/` (tsx, vitest) and `dist/lib/` (compiled) alike. */
const BUNDLE_PATH = path.resolve(__dirname, '..', '..', 'dist-editor-core', 'editor-core.cjs');

let bundle: EditorCoreBundle | null = null;

function core(): EditorCoreBundle {
  if (!bundle) {
    const load = createRequire(__filename);
    try {
      bundle = load(BUNDLE_PATH) as EditorCoreBundle;
    } catch (err) {
      throw new Error(
        `Editor core bundle not loadable at ${BUNDLE_PATH}. Run \`npm run build:editor-core\`. (${
          (err as Error).message
        })`,
      );
    }
  }
  return bundle;
}

/**
 * Load the editor core bundle. Idempotent; rejects when the bundle is missing.
 */
export async function loadEditorCore(): Promise<void> {
  core();
}

/**
 * Replace the content of a Yjs XML fragment with the parsed Markdown, in one transaction.
 * @param md - Markdown source.
 * @param fragment - A fragment of a `Y.Doc`, for example `doc.getXmlFragment('default')`.
 */
export function markdownToYFragment(md: string, fragment: Y.XmlFragment): void {
  core().markdownToYFragment(md, fragment);
}

/**
 * Serialize the collaborative editor's Yjs XML fragment to Markdown.
 * @param fragment - Source fragment.
 * @returns The Markdown.
 */
export function yFragmentToMarkdown(fragment: Y.XmlFragment): string {
  return core().yFragmentToMarkdown(fragment);
}

/**
 * Parse and re-serialize Markdown (md -> ProseMirror JSON -> md): the normalisation
 * the editor applies on its first save. Stable: normalising twice changes nothing.
 * @param md - Markdown source.
 * @returns The normalised Markdown.
 */
export function normalizeMarkdown(md: string): string {
  return core().normalizeMarkdown(md);
}

/**
 * Block-level three-way merge of normalised Markdown, the same merge the browser runs.
 * @param base - Common ancestor.
 * @param ours - One side.
 * @param theirs - The other side.
 * @returns The merged Markdown (null on conflicts) and the hunks.
 */
export function mergeMarkdown(base: string, ours: string, theirs: string): MergeResult {
  return core().mergeMarkdown(base, ours, theirs);
}

/**
 * The live blocks of a body, read as the editor reads it: text that merely looks like one, in a
 * code block or a paragraph, is not one.
 * @param md - Markdown source.
 * @returns The target of each `:::query <target>:::` block, as written.
 */
export function queryEmbedsIn(md: string): string[] {
  return core().queryEmbedsIn(md);
}

/**
 * Read a live block's target.
 * @param target - As written in Markdown.
 * @returns What it names, or null when it names nothing.
 */
export function parseQueryEmbedTarget(target: string): QueryEmbedTarget | null {
  return core().parseQueryEmbedTarget(target);
}
