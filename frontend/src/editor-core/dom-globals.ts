/**
 * Install happy-dom globals for the server bundle.
 *
 * TipTap and tiptap-markdown parse and render through the DOM (`DOMParser`,
 * `document`, `Node.TEXT_NODE`). Imported first by `server-entry.ts`, so the globals
 * exist before any editor module is evaluated. Existing globals are left alone.
 */

import { Window } from 'happy-dom';

const window = new Window();
const g = globalThis as Record<string, unknown>;
const w = window as unknown as Record<string, unknown>;

if (g.window === undefined) g.window = window;
for (const key of ['document', 'navigator', 'DOMParser', 'Node', 'HTMLElement', 'Element']) {
  if (g[key] === undefined) g[key] = w[key];
}
