import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '../../config/database';
import { cleanupTestContext, createTestContext, type TestContext } from '../../test/factory';
import { useGithubFake } from '../../test/github-fake';
import { seedGithubApp } from '../../test/github-seed';
import { postWebhook } from '../../test/github-webhook';
import { createRule } from '../automation/automation.service';

import {
  applyDefaultGithubRules,
  createDefaultGithubRules,
  ensureDefaultGithubRules,
} from './default-rules';
import './github-resolvers';
import './webhook-handlers';

const REPO_ID = 880_800;
const INSTALLATION_ID = 4801;
const SHA = '3333333333333333333333333333333333333333';
const NAMES = {
  opened: 'GitHub: PR opened moves to In review',
  merged: 'GitHub: PR merged moves to done',
  mergeComment: 'GitHub: comment when a PR merges',
  checks: 'GitHub: comment when checks fail',
};

// A switch to make the n-th rule creation fail
const failure = vi.hoisted(() => ({ at: -1, count: 0 }));
vi.mock('../automation/automation.service', async (importOriginal) => {
  const real = await importOriginal<typeof import('../automation/automation.service')>();
  return {
    ...real,
    createRule: async (...args: Parameters<typeof real.createRule>) => {
      if (failure.at >= 0 && failure.count++ === failure.at) throw new Error('boom');
      return real.createRule(...args);
    },
  };
});

const fake = useGithubFake('checks');
let ctx: TestContext;
let p: string;
let repoLinkId: string;
let columns: Record<string, string>;
let todoIssue: string;
let doneIssue: string;

type Payload = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const repository = {
  id: REPO_ID,
  name: 'widget',
  full_name: 'acme-labs/widget',
  html_url: 'https://github.com/acme-labs/widget',
  owner: { login: 'acme-labs', id: 4001 },
};
const sender = { id: 7001, login: 'voorbeeld-dev' };

const pull = (number: number, over: Payload = {}): Payload => ({
  number,
  title: 'Add the widget',
  body: null,
  state: 'open',
  draft: false,
  merged: false,
  user: sender,
  head: { ref: `${p}-${number}-x`, sha: SHA },
  base: { ref: 'main' },
  requested_reviewers: [],
  html_url: `https://github.com/acme-labs/widget/pull/${number}`,
  created_at: '2026-11-06T09:00:00Z',
  updated_at: '2026-11-06T10:00:00Z',
  merged_at: null,
  closed_at: null,
  ...over,
});

async function prEvent(action: string, payload: Payload) {
  const deliveryId = randomUUID();
  expect(
    (
      await postWebhook(
        'pull_request',
        { action, number: payload.number, pull_request: payload, repository, sender },
        { deliveryId },
      )
    ).status,
  ).toBe(202);
  await expect
    .poll(
      async () =>
        (await prisma.githubDelivery.findUniqueOrThrow({ where: { id: deliveryId } })).status,
    )
    .not.toBe('PENDING');
}

/**
 * Gives the project these columns (names; the last flagged ones are done), two issues named by
 * number 1 and 2 in the project, and a link with no default rules yet.
 * @param names The column names in order
 * @param done The names that are done columns
 */
async function setup(names: string[], done: string[]) {
  await prisma.automationRule.deleteMany({ where: { projectId: ctx.projectId } });
  await prisma.issue.updateMany({ where: { projectId: ctx.projectId }, data: { columnId: null } });
  await prisma.boardColumn.deleteMany({ where: { projectId: ctx.projectId } });
  columns = {};
  for (const [position, name] of names.entries()) {
    columns[name] = (
      await prisma.boardColumn.create({
        data: { projectId: ctx.projectId, name, position, isDone: done.includes(name) },
      })
    ).id;
  }
  await prisma.githubRepoLink.deleteMany({ where: { repoId: BigInt(REPO_ID) } });
  repoLinkId = (
    await prisma.githubRepoLink.create({
      data: {
        projectId: ctx.projectId,
        repoId: BigInt(REPO_ID),
        installationId: BigInt(INSTALLATION_ID),
        owner: 'acme-labs',
        name: 'widget',
        fullName: 'acme-labs/widget',
        defaultBranch: 'main',
        htmlUrl: 'https://github.com/acme-labs/widget',
        linkedById: ctx.owner.id,
        lastReconciledAt: new Date(),
        createdAt: new Date('2026-11-01T00:00:00Z'),
      },
    })
  ).id;
  await prisma.comment.deleteMany({ where: { issue: { projectId: ctx.projectId } } });
  await prisma.githubAutomationMark.deleteMany({ where: { issue: { projectId: ctx.projectId } } });
}

const names = async () =>
  (
    await prisma.automationRule.findMany({
      where: { projectId: ctx.projectId },
      orderBy: { name: 'asc' },
    })
  ).map((r) => r.name);
const columnOf = async (id: string) =>
  (await prisma.issue.findUniqueOrThrow({ where: { id } })).columnId;

beforeAll(async () => {
  await seedGithubApp({ fake });
  fake.addInstallation(INSTALLATION_ID, ['acme-labs/widget']);
  ctx = await createTestContext('gdr1');
  p = ctx.projectPrefix.toLowerCase();
  for (const n of [1, 2]) {
    const row = await prisma.issue.create({
      data: {
        projectId: ctx.projectId,
        number: n,
        title: `Issue ${n}`,
        body: '',
        creatorId: ctx.owner.id,
      },
    });
    if (n === 1) todoIssue = row.id;
    else doneIssue = row.id;
  }
});

beforeEach(async () => {
  failure.at = -1;
  failure.count = 0;
  await prisma.githubAccount.deleteMany();
  await prisma.githubInstallation.deleteMany();
  await prisma.githubInstallation.create({
    data: { id: BigInt(INSTALLATION_ID), accountLogin: 'acme-labs', accountType: 'Organization' },
  });
  await prisma.githubDelivery.deleteMany();
});

afterAll(async () => {
  await prisma.githubRepoLink.deleteMany({ where: { repoId: BigInt(REPO_ID) } });
  await prisma.githubInstallation.deleteMany();
  await cleanupTestContext(ctx);
});

describe('default rules on link', () => {
  it('creates three rules for To Do, In Review and Done, and a PR opened on a To Do issue moves to In Review', async () => {
    await setup(['To Do', 'In Review', 'Done'], ['Done']);
    expect(await applyDefaultGithubRules(repoLinkId)).toEqual([
      NAMES.opened,
      NAMES.merged,
      NAMES.mergeComment,
      NAMES.checks,
    ]);
    expect(await names()).toEqual(Object.values(NAMES).sort());
    const rules = await prisma.automationRule.findMany({ where: { projectId: ctx.projectId } });
    const byName = (n: string) => rules.find((r) => r.name === n)!;
    expect(byName(NAMES.opened)).toMatchObject({
      trigger: 'pr:opened',
      condition: 'done = false',
      actions: [{ type: 'set_status', columnId: columns['In Review'] }],
    });
    expect(byName(NAMES.merged)).toMatchObject({
      trigger: 'pr:merged',
      condition: 'done = false',
      actions: [{ type: 'set_status', columnId: columns.Done }],
    });
    const comment = byName(NAMES.mergeComment);
    expect(comment).toMatchObject({
      trigger: 'pr:merged',
      actions: [{ type: 'add_comment', body: 'Merged in {{github.pr.url}}' }],
    });
    expect(comment.condition).toBeNull();
    expect(byName(NAMES.checks)).toMatchObject({
      trigger: 'checks:failed',
      actions: [
        {
          type: 'add_comment',
          body: 'Checks failed on {{github.pr.url}} at {{github.checks.headSha}}: {{github.checks.failedNames}}',
        },
      ],
    });
    expect(
      (await prisma.githubRepoLink.findUniqueOrThrow({ where: { id: repoLinkId } }))
        .defaultRulesCreatedAt,
    ).not.toBeNull();

    await prisma.issue.update({ where: { id: todoIssue }, data: { columnId: columns['To Do'] } });
    await prEvent('opened', pull(31, { head: { ref: `${p}-1-x`, sha: SHA } }));
    expect(await columnOf(todoIssue)).toBe(columns['In Review']);
  });

  it('leaves an issue that is already done in Done when a PR opens on it', async () => {
    await setup(['To Do', 'In Review', 'Done'], ['Done']);
    await applyDefaultGithubRules(repoLinkId);
    await prisma.issue.update({ where: { id: doneIssue }, data: { columnId: columns.Done } });
    await prEvent('opened', pull(32, { head: { ref: `${p}-2-x`, sha: SHA } }));
    expect(await columnOf(doneIssue)).toBe(columns.Done);
  });

  it('makes three rules for a project without an In review column', async () => {
    await setup(['To Do', 'In Progress', 'Done'], ['Done']);
    expect((await applyDefaultGithubRules(repoLinkId)).sort()).toEqual(
      [NAMES.checks, NAMES.merged, NAMES.mergeComment].sort(),
    );
    expect(await names()).toEqual([NAMES.checks, NAMES.merged, NAMES.mergeComment].sort());
  });

  it('matches the In review column by trimmed, case-insensitive name and keeps the done condition when nothing is done', async () => {
    await setup(['To Do', '  in REVIEW '], []);
    await applyDefaultGithubRules(repoLinkId);
    const opened = await prisma.automationRule.findFirstOrThrow({
      where: { projectId: ctx.projectId, name: NAMES.opened },
    });
    expect(opened.condition).toBe('done = false');
    expect(opened.actions).toEqual([{ type: 'set_status', columnId: columns['  in REVIEW '] }]);
    // No done column: nothing to move to, so no move rule; the comment rule stays
    expect(await names()).toEqual([NAMES.opened, NAMES.mergeComment, NAMES.checks].sort());
  });

  it('moves a merged PR to the lowest done column and comments the URL', async () => {
    await setup(['To Do', 'Released', 'Done'], ['Done', 'Released']);
    await createDefaultGithubRules(ctx.projectId);
    await prEvent('opened', pull(33, { head: { ref: `${p}-1-x`, sha: SHA } }));
    await prEvent(
      'closed',
      pull(33, {
        head: { ref: `${p}-1-x`, sha: SHA },
        state: 'closed',
        merged: true,
        merged_at: '2026-11-06T11:00:00Z',
        closed_at: '2026-11-06T11:00:00Z',
        updated_at: '2026-11-06T11:00:00Z',
      }),
    );
    expect(await columnOf(todoIssue)).toBe(columns.Released);
    const bodies = (await prisma.comment.findMany({ where: { issueId: todoIssue } })).map(
      (c) => c.body,
    );
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatch(/^Merged in https?\\?:\/\/github\.com\/acme-labs\/widget\/pull\/33$/);
  });

  it('comments on a merge for a ticket that is already done, and leaves it where it is', async () => {
    await setup(['To Do', 'Released', 'Done'], ['Done', 'Released']);
    await applyDefaultGithubRules(repoLinkId);
    await prisma.issue.update({ where: { id: doneIssue }, data: { columnId: columns.Released } });
    await prEvent('opened', pull(36, { head: { ref: `${p}-2-x`, sha: SHA } }));
    await prEvent(
      'closed',
      pull(36, {
        head: { ref: `${p}-2-x`, sha: SHA },
        state: 'closed',
        merged: true,
        merged_at: '2026-11-06T11:00:00Z',
        closed_at: '2026-11-06T11:00:00Z',
        updated_at: '2026-11-06T11:00:00Z',
      }),
    );
    expect(await columnOf(doneIssue)).toBe(columns.Released);
    const bodies = (await prisma.comment.findMany({ where: { issueId: doneIssue } })).map(
      (c) => c.body,
    );
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatch(/^Merged in /);
  });

  it('does not bring back a deleted rule', async () => {
    await setup(['To Do', 'In Review', 'Done'], ['Done']);
    await applyDefaultGithubRules(repoLinkId);
    await prisma.automationRule.deleteMany({
      where: { projectId: ctx.projectId, name: NAMES.checks },
    });
    expect(await ensureDefaultGithubRules()).toBe(0);
    expect(await applyDefaultGithubRules(repoLinkId)).toEqual([]);
    expect(await names()).toEqual([NAMES.opened, NAMES.merged, NAMES.mergeComment].sort());
  });

  it('gives a link made before this shipped its rules, once', async () => {
    await setup(['To Do', 'In Review', 'Done'], ['Done']);
    expect(await ensureDefaultGithubRules()).toBeGreaterThanOrEqual(1);
    expect(await names()).toEqual(Object.values(NAMES).sort());
    expect(await ensureDefaultGithubRules()).toBe(0);
    expect(await names()).toHaveLength(4);
  });

  it('creates the rules once when two callers race', async () => {
    await setup(['To Do', 'In Review', 'Done'], ['Done']);
    await Promise.all([applyDefaultGithubRules(repoLinkId), applyDefaultGithubRules(repoLinkId)]);
    expect(await names()).toHaveLength(4);
  });

  it('goes through the rule validation: a failing rule leaves the link unmarked, to try again', async () => {
    await setup(['To Do', 'In Review', 'Done'], ['Done']);
    // The project is gone for the rule service: createRule refuses
    await expect(
      createRule('does-not-exist', { name: 'x', trigger: 'pr:opened', actions: [] }),
    ).rejects.toThrow();
    await expect(createDefaultGithubRules('does-not-exist')).rejects.toThrow();
  });

  it('still blocks the move after a done column is renamed, and for a name with a quote', async () => {
    await setup(['To Do', 'In Review', 'Done'], ['Done']);
    await applyDefaultGithubRules(repoLinkId);
    await prisma.boardColumn.update({ where: { id: columns.Done }, data: { name: 'Shi"pped' } });
    await prisma.issue.update({ where: { id: doneIssue }, data: { columnId: columns.Done } });
    await prEvent('opened', pull(34, { head: { ref: `${p}-2-x`, sha: SHA } }));
    expect(await columnOf(doneIssue)).toBe(columns.Done);
  });

  it('leaves a ticket in a later done column where it is when a PR merges', async () => {
    await setup(['To Do', 'In Review', 'Done', 'Released'], ['Done', 'Released']);
    await applyDefaultGithubRules(repoLinkId);
    await prisma.issue.update({ where: { id: doneIssue }, data: { columnId: columns.Released } });
    await prEvent('opened', pull(35, { head: { ref: `${p}-2-x`, sha: SHA } }));
    await prEvent(
      'closed',
      pull(35, {
        head: { ref: `${p}-2-x`, sha: SHA },
        state: 'closed',
        merged: true,
        merged_at: '2026-11-06T11:00:00Z',
        closed_at: '2026-11-06T11:00:00Z',
        updated_at: '2026-11-06T11:00:00Z',
      }),
    );
    expect(await columnOf(doneIssue)).toBe(columns.Released);
  });

  it('keeps the mark when some rules were made before a failure, and takes it back when none were (M4)', async () => {
    await setup(['To Do', 'In Review', 'Done'], ['Done']);
    failure.at = 1;
    await expect(applyDefaultGithubRules(repoLinkId)).rejects.toThrow('boom');
    expect(await names()).toHaveLength(1);
    const mark = async () =>
      (await prisma.githubRepoLink.findUniqueOrThrow({ where: { id: repoLinkId } }))
        .defaultRulesCreatedAt;
    expect(await mark()).not.toBeNull();
    await prisma.automationRule.deleteMany({ where: { projectId: ctx.projectId } });
    expect(await ensureDefaultGithubRules()).toBe(0);
    expect(await names()).toHaveLength(0);

    await prisma.githubRepoLink.update({
      where: { id: repoLinkId },
      data: { defaultRulesCreatedAt: null },
    });
    failure.at = 0;
    failure.count = 0;
    await expect(applyDefaultGithubRules(repoLinkId)).rejects.toThrow('boom');
    expect(await mark()).toBeNull();
  });
});
