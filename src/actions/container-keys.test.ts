/**
 * act's key also names containers: org/team/space for a space, AXM or org/team/AXM for a project.
 * Same visibility and ambiguity rules as the keys of items, against the real database.
 */
import crypto from 'crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../config/database';
import {
  addMemberToContext,
  cleanupTestContext,
  createTestContext,
  createTestUser,
  type TestContext,
  type TestUser,
} from '../test/factory';

import { runAct } from './batch';
import type { ActionContext } from './define';
import { resolveContainerKey } from './keys';

describe('container keys', () => {
  let ctx: TestContext;
  let teamMember: TestUser;
  let offTeam: TestUser;
  let stranger: TestUser;
  let spaceId: string;
  let spaceKey: string;
  let shared: string;
  const extraUsers: string[] = [];

  const as = (user: TestUser): ActionContext => ({ userId: user.id, channel: 'ui' });
  const act = (user: TestUser, request: Parameters<typeof runAct>[0]) => runAct(request, as(user));

  beforeAll(async () => {
    ctx = await createTestContext(`ckey${Date.now()}`);
    teamMember = await addMemberToContext(ctx);
    // In the org but on no team
    offTeam = await createTestUser();
    await prisma.orgMembership.create({
      data: { orgId: ctx.orgId, userId: offTeam.id, role: 'MEMBER' },
    });
    stranger = await createTestUser();
    extraUsers.push(teamMember.id, offTeam.id, stranger.id);

    const space = await prisma.wikiSpace.create({
      data: { teamId: ctx.teamId, name: 'Containers', slug: 'container-space' },
    });
    spaceId = space.id;
    spaceKey = `${ctx.orgSlug}/${ctx.teamSlug}/container-space`;

    shared = `Q${crypto.randomBytes(3).toString('hex').toUpperCase().replace(/\d/g, 'K')}`;
    const second = await prisma.team.create({
      data: { orgId: ctx.orgId, name: 'Second', slug: 'container-second' },
    });
    await prisma.teamMembership.create({
      data: { teamId: second.id, userId: teamMember.id, role: 'MEMBER' },
    });
    await prisma.project.createMany({
      data: [
        { teamId: ctx.teamId, name: 'A', slug: 'container-a', prefix: shared },
        { teamId: second.id, name: 'B', slug: 'container-b', prefix: shared },
      ],
    });
  });

  afterAll(async () => {
    await cleanupTestContext(ctx);
    await prisma.user.deleteMany({ where: { id: { in: extraUsers } } });
  });

  describe('a space', () => {
    it('lets page.create work in the space a key names', async () => {
      const page = (await act(ctx.owner, {
        action: 'page.create',
        key: spaceKey,
        input: { title: 'By space key', slug: 'by-space-key', body: 'Hello' },
      })) as { spaceId: string; slug: string };
      expect(page).toMatchObject({ spaceId, slug: 'by-space-key' });
    });

    it('answers a stranger and a space that does not exist alike', async () => {
      const hidden = await resolveContainerKey(spaceKey, 'space', stranger.id).catch((e) => e);
      const missing = await resolveContainerKey(
        `${ctx.orgSlug}/${ctx.teamSlug}/nowhere`,
        'space',
        ctx.owner.id,
      ).catch((e) => e);
      expect(hidden).toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
      expect(hidden.message).toBe(missing.message);
      expect(missing).toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
    });

    it('lets a platform admin outside the org use a space, as with a project', async () => {
      const admin = await createTestUser();
      extraUsers.push(admin.id);
      await prisma.user.update({ where: { id: admin.id }, data: { isAdmin: true } });
      await expect(resolveContainerKey(spaceKey, 'space', admin.id)).resolves.toEqual({
        kind: 'space',
        spaceId,
      });
      const fetched = (await act(admin, { action: 'space.get', input: { spaceId } })) as {
        id: string;
      };
      expect(fetched.id).toBe(spaceId);
      const page = (await act(admin, {
        action: 'page.create',
        key: spaceKey,
        input: { title: 'By platform admin', slug: 'by-platform-admin', body: 'Hello' },
      })) as { spaceId: string };
      expect(page.spaceId).toBe(spaceId);
    });

    it('follows the space access rule: not an off-team member, not past a custom permission', async () => {
      await expect(resolveContainerKey(spaceKey, 'space', offTeam.id)).rejects.toMatchObject({
        statusCode: 404,
      });
      await expect(resolveContainerKey(spaceKey, 'space', teamMember.id)).resolves.toEqual({
        kind: 'space',
        spaceId,
      });
      await prisma.spacePermission.create({
        data: { spaceId, userId: ctx.owner.id, level: 'ADMIN' },
      });
      try {
        await expect(resolveContainerKey(spaceKey, 'space', teamMember.id)).rejects.toMatchObject({
          statusCode: 404,
        });
        await expect(resolveContainerKey(spaceKey, 'space', ctx.owner.id)).resolves.toMatchObject({
          spaceId,
        });
      } finally {
        await prisma.spacePermission.deleteMany({ where: { spaceId } });
      }
    });

    it('refuses the key of a page or an issue on an action that wants a space', async () => {
      for (const key of [`${spaceKey}/by-space-key`, `${ctx.projectPrefix}-1`]) {
        await expect(
          act(ctx.owner, {
            action: 'page.create',
            key,
            input: { title: 'X', slug: 'x-never' },
          }),
        ).rejects.toMatchObject({ statusCode: 400, code: 'KEY_NOT_ACCEPTED' });
      }
    });

    it('refuses a key that names another space than the input', async () => {
      await expect(
        act(ctx.owner, {
          action: 'page.create',
          key: spaceKey,
          input: { spaceId: 'other', title: 'X', slug: 'x-never' },
        }),
      ).rejects.toMatchObject({ statusCode: 400, code: 'KEY_CONFLICT' });
    });
  });

  describe('a project', () => {
    const create = (user: TestUser, key: string) =>
      act(user, { action: 'issue.create', key, input: { title: 'By project key' } }) as Promise<{
        projectId: string;
        title: string;
      }>;

    it('lets issue.create work in the project a prefix or a full key names', async () => {
      const bare = await create(ctx.owner, ctx.projectPrefix);
      expect(bare).toMatchObject({ projectId: ctx.projectId, title: 'By project key' });
      const full = await create(ctx.owner, `${ctx.orgSlug}/${ctx.teamSlug}/${ctx.projectPrefix}`);
      expect(full.projectId).toBe(ctx.projectId);
    });

    it('answers a stranger, an off-team member and a missing project alike', async () => {
      const answers = await Promise.all(
        [
          [stranger.id, ctx.projectPrefix],
          [offTeam.id, ctx.projectPrefix],
          [offTeam.id, `${ctx.orgSlug}/${ctx.teamSlug}/${ctx.projectPrefix}`],
          [ctx.owner.id, 'NOSUCHPREFIX'],
        ].map(([user, key]) => resolveContainerKey(key, 'project', user).catch((e) => e)),
      );
      for (const answer of answers) {
        expect(answer).toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
        expect(answer.message).toBe(answers[0].message);
      }
    });

    it('is ambiguous only among the projects the user can see', async () => {
      await expect(resolveContainerKey(shared, 'project', teamMember.id)).rejects.toMatchObject({
        statusCode: 409,
        code: 'AMBIGUOUS_KEY',
        details: {
          candidates: expect.arrayContaining([
            `${ctx.orgSlug}/${ctx.teamSlug}/${shared}`,
            `${ctx.orgSlug}/container-second/${shared}`,
          ]),
        },
      });
      // The owner is on the first team only: the other project neither shows nor blurs the key
      const second = await prisma.project.findFirstOrThrow({
        where: { prefix: shared, teamId: ctx.teamId },
      });
      await expect(resolveContainerKey(shared, 'project', ctx.owner.id)).resolves.toEqual({
        kind: 'project',
        projectId: second.id,
      });
    });

    it('refuses a key of another kind and a key that disagrees with the input', async () => {
      await expect(
        act(ctx.owner, {
          action: 'issue.create',
          key: `${ctx.projectPrefix}-1`,
          input: { title: 'X' },
        }),
      ).rejects.toMatchObject({ statusCode: 400, code: 'KEY_NOT_ACCEPTED' });
      await expect(
        act(ctx.owner, {
          action: 'issue.create',
          key: spaceKey,
          input: { title: 'X' },
        }),
      ).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_KEY' });
      await expect(
        act(ctx.owner, {
          action: 'issue.create',
          key: ctx.projectPrefix,
          input: { projectId: 'other', title: 'X' },
        }),
      ).rejects.toMatchObject({ statusCode: 400, code: 'KEY_CONFLICT' });
    });
  });
});
