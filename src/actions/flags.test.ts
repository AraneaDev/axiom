import { readdirSync } from 'fs';
import path from 'path';

import { beforeAll, describe, expect, it } from 'vitest';

import { listActions } from './registry';

/**
 * Actions whose name says delete or remove and which destroy data, so an agent's call asks first.
 * A new action that deletes must be flagged `destructive: true`; one that only unlinks or
 * reorders goes in NOT_DESTRUCTIVE with the reason.
 */
const NOT_DESTRUCTIVE: Record<string, string> = {
  'sprint.removeIssues': 'puts the issues back in the backlog, nothing is deleted',
};

beforeAll(async () => {
  const root = path.resolve(__dirname, '..');
  const files = readdirSync(root, { recursive: true, encoding: 'utf8' }).filter(
    (file) => file.endsWith('.actions.ts') && !file.split(path.sep).includes('node_modules'),
  );
  for (const file of files) await import(path.join(root, file));
});

describe('action flags', () => {
  it('flags every delete and remove action destructive', () => {
    const missing = listActions()
      .filter((def) => /\.(delete|remove)$/.test(def.name) && !(def.name in NOT_DESTRUCTIVE))
      .filter((def) => !def.destructive)
      .map((def) => def.name);
    expect(missing).toEqual([]);
  });

  it('flags every action in area admin as admin', () => {
    const missing = listActions()
      .filter((def) => def.area === 'admin' && !def.admin)
      .map((def) => def.name);
    expect(missing).toEqual([]);
  });

  it('keeps the exceptions list honest', () => {
    const names = new Set(listActions().map((def) => def.name));
    for (const name of Object.keys(NOT_DESTRUCTIVE)) expect(names.has(name)).toBe(true);
  });

  it('gives a move a crossContainer check and a bulk a count', () => {
    const byName = new Map(listActions().map((def) => [def.name, def]));
    expect(byName.get('issue.move')?.crossContainer).toBeTypeOf('function');
    expect(byName.get('page.move')?.crossContainer).toBeTypeOf('function');
    expect(byName.get('issue.bulkUpdate')?.bulkCount).toBeTypeOf('function');
  });
});
