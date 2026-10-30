import fs from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

const SRC = path.resolve(__dirname, '..');

/**
 * Runtime imports (type-only imports left out) of a source file, resolved to files under src/.
 * @param file - Absolute path of a .ts file
 */
function runtimeImports(file: string): string[] {
  const source = fs.readFileSync(file, 'utf-8');
  const found: string[] = [];
  for (const match of source.matchAll(
    /^(?:import|export)\s+(?!type\b)[^;]*?from\s+'(\.[^']+)'/gms,
  )) {
    const target = path.resolve(path.dirname(file), match[1]);
    const resolved = [`${target}.ts`, path.join(target, 'index.ts')].find((f) => fs.existsSync(f));
    if (resolved) found.push(resolved);
  }
  return found;
}

/**
 * Every import cycle reachable from the entry files, each as a list of paths relative to src/.
 * @param entries - Absolute paths to start from
 */
function importCycles(entries: string[]): string[][] {
  const cycles: string[][] = [];
  const done = new Set<string>();
  const stack: string[] = [];
  const visit = (file: string) => {
    if (stack.includes(file)) {
      cycles.push(stack.slice(stack.indexOf(file)).map((f) => path.relative(SRC, f)));
      return;
    }
    if (done.has(file)) return;
    stack.push(file);
    for (const dep of runtimeImports(file)) visit(dep);
    stack.pop();
    done.add(file);
  };
  entries.forEach(visit);
  return cycles;
}

describe('room registry', () => {
  it('leaves no import cycle between the wiki write path and the realtime servers', () => {
    const dirs = ['realtime', 'modules/wiki'].map((d) => path.join(SRC, d));
    const entries = dirs.flatMap((dir) =>
      fs
        .readdirSync(dir)
        .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
        .map((f) => path.join(dir, f)),
    );
    const touching = importCycles(entries).filter((cycle) =>
      cycle.some((f) => f.startsWith('realtime/') || f.startsWith('modules/wiki/')),
    );
    expect(touching).toEqual([]);
  });
});
