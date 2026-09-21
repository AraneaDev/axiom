import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { prisma } from '../config/database';
import {
  addMemberToContext,
  cleanupTestContext,
  createTestContext,
  createTestUser,
  type TestContext,
  type TestUser,
} from '../test/factory';
import { authPost } from '../test/helpers';

import { resolveRepoForGit } from './git-access';

describe('resolveRepoForGit', () => {
  let ctx: TestContext;
  let viewer: TestUser;
  let outsider: TestUser;
  let repoSlug: string;

  beforeAll(async () => {
    ctx = await createTestContext();
    const res = await authPost(`/api/repos/team/${ctx.teamId}`, ctx.owner.token, {
      name: 'Access Repo',
      slug: 'access-repo',
    });
    repoSlug = res.body.slug;

    viewer = await addMemberToContext(ctx, {
      email: `viewer-${Date.now()}@test.dev`,
      username: `viewer-${Date.now()}`,
    });
    await prisma.orgMembership.update({
      where: { userId_orgId: { userId: viewer.id, orgId: ctx.orgId } },
      data: { role: 'VIEWER' },
    });
    ctx.member = viewer;

    outsider = await createTestUser({
      email: `outsider-${Date.now()}@test.dev`,
      username: `outsider-${Date.now()}`,
    });
  });

  afterAll(async () => {
    await cleanupTestContext(ctx);
    await prisma.user.deleteMany({ where: { id: outsider.id } });
  });

  it('returns the repo with a disk path for the owner', async () => {
    const repo = await resolveRepoForGit(ctx.owner.id, ctx.orgSlug, ctx.teamSlug, repoSlug, true);
    expect(repo.slug).toBe(repoSlug);
    expect(repo.diskPath).toMatch(/access-repo\.git$/);
  });

  it('lets a viewer read', async () => {
    await expect(
      resolveRepoForGit(viewer.id, ctx.orgSlug, ctx.teamSlug, repoSlug, false),
    ).resolves.toBeDefined();
  });

  it('refuses a viewer write', async () => {
    await expect(
      resolveRepoForGit(viewer.id, ctx.orgSlug, ctx.teamSlug, repoSlug, true),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('refuses a non-member on a private repo', async () => {
    await expect(
      resolveRepoForGit(outsider.id, ctx.orgSlug, ctx.teamSlug, repoSlug, false),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('returns 404 for an unknown repo', async () => {
    await expect(
      resolveRepoForGit(ctx.owner.id, ctx.orgSlug, ctx.teamSlug, 'nope', false),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});
