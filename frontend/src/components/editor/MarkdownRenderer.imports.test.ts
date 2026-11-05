import { existsSync, readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

const SRC = path.resolve(__dirname, '../..');

/**
 * What a source loads when it loads: `import type`, `export type` and `import()` load nothing, and
 * a re-export loads what it names as an import does.
 * @param source - The source text
 */
function staticSpecifiers(source: string): string[] {
  return [
    ...source.matchAll(/^(?:import|export)\s+(?!type\b)(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]/gm),
  ].map((match) => match[1]);
}

function staticImports(file: string): string[] {
  return staticSpecifiers(readFileSync(file, 'utf8'));
}

function resolveLocal(from: string, specifier: string): string | null {
  const base = specifier.startsWith('@/')
    ? path.join(SRC, specifier.slice(2))
    : path.resolve(path.dirname(from), specifier);
  return (
    ['.ts', '.tsx', '/index.ts', '/index.tsx', ''].map((end) => base + end).find(isFile) ?? null
  );
}

function isFile(candidate: string): boolean {
  return existsSync(candidate) && /\.tsx?$/.test(candidate);
}

/**
 * Everything a file loads, followed through the source files.
 * @param entry - Path below src
 * @returns The local files reached, relative to src, and the packages
 */
function reach(entry: string): { files: string[]; packages: string[] } {
  const seen = new Set<string>();
  const packages = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const specifier of staticImports(file)) {
      if (specifier.startsWith('.') || specifier.startsWith('@/')) {
        const local = resolveLocal(file, specifier);
        if (local) visit(local);
      } else {
        packages.add(specifier);
      }
    }
  };
  visit(path.join(SRC, entry));
  return { files: [...seen].map((file) => path.relative(SRC, file)), packages: [...packages] };
}

describe('reading what a source loads', () => {
  it.each([
    ["import { a } from './a';", ['./a']],
    ["import a, {\n  b,\n} from 'pkg';", ['pkg']],
    ["import './side-effect';", ['./side-effect']],
    ["export { a } from './barrel';", ['./barrel']],
    ["export * from './all';", ['./all']],
    ["export * as all from 'pkg';", ['pkg']],
    ["export {\n  a,\n  b,\n} from './many';", ['./many']],
    ["import type { A } from './types';", []],
    ["export type { A } from './types';", []],
    ["export const a = 'not an import';", []],
    ["export function f() {\n  return 'text';\n}", []],
    ["const load = () => import('./later');", []],
  ] as const)('%s', (source, expected) => {
    expect(staticSpecifiers(source)).toEqual(expected);
  });
});

describe('what read-only pages load for live blocks', () => {
  const renderer = reach('components/editor/MarkdownRenderer.tsx');

  it('finds what the renderer loads', () => {
    expect(renderer.files).toContain('components/editor/AttachmentImage.tsx');
    expect(renderer.packages).toContain('marked');
  });

  it('MarkdownRenderer loads no editor', () => {
    expect(renderer.packages.filter((name) => name.startsWith('@tiptap'))).toEqual([]);
    expect(renderer.packages).not.toContain('yjs');
  });

  it('MarkdownRenderer loads no widgets, charts or live hooks until a block runs', () => {
    expect(
      renderer.files.filter((file) =>
        /dashboards\/QueryBlock\.tsx|dashboards\/widgets\/|useDashboardLive|useWebSocket|charts/.test(
          file,
        ),
      ),
    ).toEqual([]);
  });

  it('the editor node does not bring them to every editor either', () => {
    const node = reach('components/editor/QueryEmbedNode.tsx');
    expect(node.files.filter((file) => /dashboards\/widgets\//.test(file))).toEqual([]);
  });

  it('the target helpers stand alone', () => {
    const target = reach('editor-core/query-embed-target.ts');
    expect(target.files).toEqual(['editor-core/query-embed-target.ts']);
    expect(target.packages).toEqual([]);
  });
});
