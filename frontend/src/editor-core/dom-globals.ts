/**
 * A happy-dom DOM for the server bundle, installed only while a conversion runs.
 *
 * TipTap and tiptap-markdown parse and render through the DOM (`window.DOMParser`,
 * `document`, `Node.TEXT_NODE`) and read it from globals. The server has no DOM, so
 * `server-entry.ts` registers `withHappyDom` as the converter's DOM scope: each call
 * installs the globals that are missing, runs the conversion, and removes them again.
 * Backend code outside a conversion never sees a global `window` or `document`.
 */

import { Window } from 'happy-dom';

const KEYS = ['window', 'document', 'navigator', 'DOMParser', 'Node', 'HTMLElement', 'Element'];

let happyWindow: Window | null = null;
let depth = 0;
let installed: string[] = [];

function install(): void {
  happyWindow ??= new Window();
  const g = globalThis as Record<string, unknown>;
  const w = happyWindow as unknown as Record<string, unknown>;
  installed = KEYS.filter((key) => g[key] === undefined);
  for (const key of installed) g[key] = key === 'window' ? happyWindow : w[key];
}

function uninstall(): void {
  const g = globalThis as Record<string, unknown>;
  for (const key of installed) delete g[key];
  installed = [];
}

/**
 * Run `fn` with happy-dom globals in place, then remove the globals this call added.
 * Nested calls share the outer call's globals. Globals that already existed (a real
 * browser, jsdom in tests) are left alone.
 * @param fn - The conversion to run.
 * @returns What `fn` returns.
 */
export function withHappyDom<T>(fn: () => T): T {
  if (depth++ === 0) install();
  try {
    return fn();
  } finally {
    if (--depth === 0) uninstall();
  }
}
