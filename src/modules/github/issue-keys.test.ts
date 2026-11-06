import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../../config/database';
import { cleanupTestContext, createTestContext, type TestContext } from '../../test/factory';

import { drivesAutomation, extractIssueNumbers } from './issue-keys';
import { syncLinks } from './issue-links.service';
import { countLinkedIssues } from './repo-link.service';

describe('extractIssueNumbers', () => {
  it('reads a key from a branch name, case-insensitively', () => {
    expect(extractIssueNumbers('feature/axm-42-login', 'AXM')).toEqual([42]);
    expect(extractIssueNumbers('feature/AXM-42-login', 'axm')).toEqual([42]);
  });

  it('never lets a longer prefix match a shorter one', () => {
    expect(extractIssueNumbers('AXMX-4 and AXM-4', 'AXM')).toEqual([4]);
    expect(extractIssueNumbers('AXMX-4', 'AXM')).toEqual([]);
    expect(extractIssueNumbers('1AXM-4', 'AXM')).toEqual([]);
  });

  it('refuses 0, trailing letters and numbers past the integer range', () => {
    expect(extractIssueNumbers('AXM-0', 'AXM')).toEqual([]);
    expect(extractIssueNumbers('AXM-42a', 'AXM')).toEqual([]);
    expect(extractIssueNumbers('AXM-42_x', 'AXM')).toEqual([42]);
    expect(extractIssueNumbers('AXM-2147483647 AXM-2147483648', 'AXM')).toEqual([2147483647]);
  });

  it('deduplicates in order of appearance', () => {
    expect(extractIssueNumbers('AXM-3 axm-1 AXM-3 AXM-2', 'AXM')).toEqual([3, 1, 2]);
  });

  it('keeps at most 20', () => {
    const text = Array.from({ length: 25 }, (_, i) => `AXM-${i + 1}`).join(' ');
    const found = extractIssueNumbers(text, 'AXM');
    expect(found).toHaveLength(20);
    expect(found[0]).toBe(1);
    expect(found[19]).toBe(20);
  });

  it('escapes regex characters in a prefix', () => {
    expect(extractIssueNumbers('AXM-1 A.M-2 A+M-3', 'A.M')).toEqual([2]);
    expect(extractIssueNumbers('A+M-3', 'A+M')).toEqual([3]);
  });
});

describe('drivesAutomation', () => {
  it('is true for a branch name or a PR title only', () => {
    expect(drivesAutomation(['BRANCH_NAME'])).toBe(true);
    expect(drivesAutomation(['PR_BODY', 'PR_TITLE'])).toBe(true);
    expect(drivesAutomation(['PR_BODY'])).toBe(false);
    expect(drivesAutomation(['COMMIT_MESSAGE'])).toBe(false);
    expect(drivesAutomation([])).toBe(false);
  });
});

describe('syncLinks', () => {
  let ctx: TestContext;
  let otherCtx: TestContext;
  let repoLinkId: string;
  const issueIds: Record<number, string> = {};
  let foreignIssueId: string;
  let repoSeq = 0;

  const makeIssue = (projectId: string, number: number, creatorId = ctx.owner.id) =>
    prisma.issue.create({
      data: { projectId, number, title: `Issue ${number}`, body: '', creatorId },
    });
  const target = (key: string) => ({ type: 'PULL_REQUEST' as const, key });
  const sourcesOf = async (key: string) =>
    Object.fromEntries(
      (await prisma.githubIssueLink.findMany({ where: { targetKey: key } })).map((l) => [
        l.issueId,
        l.sources.slice().sort(),
      ]),
    );

  beforeAll(async () => {
    ctx = await createTestContext('gla1');
    otherCtx = await createTestContext('glb2');
    // Numbers are free: the factory makes no issues
    for (const n of [1, 2, 3]) issueIds[n] = (await makeIssue(ctx.projectId, n)).id;
    foreignIssueId = (await makeIssue(otherCtx.projectId, 1, otherCtx.owner.id)).id;
    await makeIssue(otherCtx.projectId, 7, otherCtx.owner.id);
    repoLinkId = (
      await prisma.githubRepoLink.create({
        data: {
          projectId: ctx.projectId,
          repoId: BigInt(900000 + ++repoSeq),
          installationId: 1n,
          owner: 'acme-labs',
          name: 'widget',
          fullName: 'acme-labs/widget',
          defaultBranch: 'main',
          htmlUrl: 'https://github.com/acme-labs/widget',
          linkedById: ctx.owner.id,
        },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.githubRepoLink.deleteMany({ where: { id: repoLinkId } });
    await cleanupTestContext(ctx);
    await cleanupTestContext(otherCtx);
  });

  const prefix = () => ctx.projectPrefix;

  it('links title and body issues with their own sources', async () => {
    const res = await syncLinks(repoLinkId, target('pr-1'), {
      PR_TITLE: `${prefix()}-1 fix`,
      PR_BODY: `Closes ${prefix()}-2`,
    });
    expect(await sourcesOf('pr-1')).toEqual({
      [issueIds[1]]: ['PR_TITLE'],
      [issueIds[2]]: ['PR_BODY'],
    });
    expect(res.added.sort()).toEqual([issueIds[1], issueIds[2]].sort());
    expect(res.removed).toEqual([]);
    expect(res.linked.sort()).toEqual([issueIds[1], issueIds[2]].sort());
    expect(res.driving).toEqual([issueIds[1]]);
  });

  it('keeps every source that names an issue', async () => {
    await syncLinks(repoLinkId, target('pr-2'), {
      PR_TITLE: `${prefix()}-1`,
      PR_BODY: `${prefix()}-1 again`,
    });
    expect(await sourcesOf('pr-2')).toEqual({ [issueIds[1]]: ['PR_BODY', 'PR_TITLE'] });
  });

  it('drops a link left without sources and keeps the others on a re-sync', async () => {
    const res = await syncLinks(repoLinkId, target('pr-1'), {
      PR_TITLE: `${prefix()}-3`,
      PR_BODY: `Closes ${prefix()}-2`,
    });
    expect(await sourcesOf('pr-1')).toEqual({
      [issueIds[3]]: ['PR_TITLE'],
      [issueIds[2]]: ['PR_BODY'],
    });
    expect(res.added).toEqual([issueIds[3]]);
    expect(res.removed).toEqual([issueIds[1]]);
    expect(res.driving).toEqual([issueIds[3]]);
  });

  it('ignores numbers that are no issue of the linked project, and other projects keys', async () => {
    const res = await syncLinks(repoLinkId, target('pr-3'), {
      PR_TITLE: `${prefix()}-99 ${otherCtx.projectPrefix}-1 ${otherCtx.projectPrefix}-7`,
    });
    expect(res.linked).toEqual([]);
    expect(await prisma.githubIssueLink.count({ where: { targetKey: 'pr-3' } })).toBe(0);
    expect(foreignIssueId).toBeTruthy();
  });

  it('links a commit through its message only', async () => {
    const res = await syncLinks(
      repoLinkId,
      { type: 'COMMIT', key: 'abc123' },
      {
        COMMIT_MESSAGE: `${prefix()}-2: do it`,
      },
    );
    expect(res.linked).toEqual([issueIds[2]]);
    expect(res.driving).toEqual([]);
  });

  it('leaves two racing calls on one target with one consistent row per issue', async () => {
    const texts = { PR_TITLE: `${prefix()}-1 ${prefix()}-2`, PR_BODY: `${prefix()}-1` };
    await Promise.all(
      Array.from({ length: 6 }, () => syncLinks(repoLinkId, target('pr-race'), texts)),
    );
    expect(await sourcesOf('pr-race')).toEqual({
      [issueIds[1]]: ['PR_BODY', 'PR_TITLE'],
      [issueIds[2]]: ['PR_TITLE'],
    });
  });

  it('removes links with the issue (cascade)', async () => {
    await syncLinks(repoLinkId, target('pr-4'), { PR_TITLE: `${prefix()}-3` });
    await prisma.issue.delete({ where: { id: issueIds[3] } });
    expect(await prisma.githubIssueLink.count({ where: { issueId: issueIds[3] } })).toBe(0);
  });

  it('counts the distinct issues linked through a repo link', async () => {
    const before = await countLinkedIssues(repoLinkId);
    // Issue 1 and 2 are linked through several targets, issue 3 is deleted
    expect(before).toBe(2);
    expect(await countLinkedIssues('nope')).toBe(0);
  });
});
