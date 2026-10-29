/**
 * Build the shared editor core (frontend/src/editor-core) into a CommonJS bundle
 * for the backend: dist-editor-core/editor-core.cjs.
 *
 * The bundle carries its own single copy of TipTap, ProseMirror, tiptap-markdown
 * and happy-dom, resolved from frontend/node_modules. `yjs` and `lib0` stay
 * external so the backend passes in fragments from its own copy of yjs.
 *
 * Usage: node scripts/build-editor-core.mjs [--if-stale]
 *   --if-stale  skip the build when the bundle is newer than every editor-core source
 *               file and the frontend lockfile (used by the test setup)
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outfile = path.join(root, 'dist-editor-core', 'editor-core.cjs');
const sourceDir = path.join(root, 'frontend', 'src', 'editor-core');

function newestInput() {
  let newest = statSync(path.join(root, 'frontend', 'package-lock.json')).mtimeMs;
  for (const entry of readdirSync(sourceDir, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) {
      newest = Math.max(newest, statSync(path.join(entry.parentPath, entry.name)).mtimeMs);
    }
  }
  return newest;
}

if (
  process.argv.includes('--if-stale') &&
  existsSync(outfile) &&
  statSync(outfile).mtimeMs >= newestInput()
) {
  process.exit(0);
}

await build({
  entryPoints: [path.join(root, 'frontend', 'src', 'editor-core', 'server-entry.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  external: ['yjs', 'lib0', 'lib0/*'],
  tsconfig: path.join(root, 'frontend', 'tsconfig.json'),
  logLevel: 'warning',
  // A package.json above the repository (outside our control) may trip this.
  logOverride: { 'duplicate-object-key': 'silent' },
  legalComments: 'none',
});

console.log(`editor core built: ${path.relative(root, outfile)}`);
