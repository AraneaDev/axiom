import { readdirSync } from 'fs';
import path from 'path';

import { beforeAll, describe, expect, it } from 'vitest';

import { DEFAULT_POLICY, needsApproval } from './approval-policy';
import type { ActionContext, ActionDef } from './define';
import { listActions } from './registry';

/**
 * Actions whose name says delete or remove and which destroy data, so an agent's call asks first.
 * A new action that deletes must be flagged `destructive: true`; one that only unlinks or
 * reorders goes in NOT_DESTRUCTIVE with the reason.
 */
const NOT_DESTRUCTIVE: Record<string, string> = {
  'sprint.removeIssues': 'puts the issues back in the backlog, nothing is deleted',
};

/** Actions that must stay destructive: a dropped flag fails here by name. */
const MUST_BE_DESTRUCTIVE = [
  'attachment.delete',
  'dashboard.delete',
  'dashboardWidget.remove',
  'issue.delete',
  'comment.delete',
  'issueLink.delete',
  'issueWebLink.delete',
  'savedQuery.delete',
  'page.delete',
  'pageIssueLink.remove',
  'githubPr.merge',
  'githubPr.close',
  'githubBranch.delete',
];

/** Actions that take a list of ids and must count it against the bulk threshold. */
const MUST_COUNT_BULK = ['issue.bulkUpdate', 'sprint.addIssues'];

const token: ActionContext = {
  userId: 'u1',
  channel: 'rest-token',
  apiTokenId: 't1',
  scopes: ['issues:write', 'sprints:write'],
};

const DESTRUCTIVE_NAME = /\.(delete|remove|revoke|purge|setRole|grant)$/;

/**
 * The actions whose name says they destroy data or change access but are not flagged.
 * @param defs - The actions
 */
function unflagged(defs: ActionDef[]): string[] {
  return defs
    .filter((def) => DESTRUCTIVE_NAME.test(def.name) && !(def.name in NOT_DESTRUCTIVE))
    .filter((def) => !def.destructive)
    .map((def) => def.name);
}

beforeAll(async () => {
  const root = path.resolve(__dirname, '..');
  const files = readdirSync(root, { recursive: true, encoding: 'utf8' }).filter(
    (file) => file.endsWith('.actions.ts') && !file.split(path.sep).includes('node_modules'),
  );
  for (const file of files) await import(path.join(root, file));
});

describe('action flags', () => {
  it('sees the whole registry', () => {
    expect(listActions().length).toBeGreaterThan(90);
  });

  it('keeps the named destructive actions flagged', () => {
    const byName = new Map(listActions().map((def) => [def.name, def]));
    const dropped = MUST_BE_DESTRUCTIVE.filter((name) => byName.get(name)?.destructive !== true);
    expect(dropped).toEqual([]);
  });

  it.each(MUST_COUNT_BULK)('%s asks for approval over 10 ids and not at 10', async (name) => {
    const def = listActions().find((d) => d.name === name);
    expect(def?.bulkCount).toBeTypeOf('function');
    const ids = (n: number) => ({ issueIds: Array.from({ length: n }, (_, i) => `i${i}`) });
    expect(await needsApproval(def!, ids(10), token, DEFAULT_POLICY)).toBe(false);
    expect(await needsApproval(def!, ids(11), token, DEFAULT_POLICY)).toBe(true);
  });

  it('flags every delete, remove, revoke, purge, setRole and grant action destructive', () => {
    expect(unflagged(listActions())).toEqual([]);
  });

  it('names an unflagged revoke, and passes one that is flagged', () => {
    const fake = (name: string, destructive?: boolean) => ({ name, destructive }) as ActionDef;
    expect(
      unflagged([fake('x.revoke'), fake('x.purge'), fake('x.setRole'), fake('x.grant')]),
    ).toEqual(['x.revoke', 'x.purge', 'x.setRole', 'x.grant']);
    expect(unflagged([fake('x.revoke', true), fake('sprint.removeIssues')])).toEqual([]);
  });

  it('flags every action in area admin as admin, or as uiOnly when no token can reach it', () => {
    // Sign-in, health and the site settings sit in area admin because they are the platform's
    // own. Being uiOnly they open to no token, so they need no approval flag
    const missing = listActions()
      .filter((def) => def.area === 'admin' && !def.admin && !def.uiOnly)
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
