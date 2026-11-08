/**
 * A bot stays only where one of its owners is (decision 9): it joins a team or a space only where
 * an owner is, in at most a member's or an editor's role, and it leaves a place when its last
 * owner there does. A bot left with no owner is suspended; owners and org admins suspend and
 * resume it by hand.
 */
import crypto from 'crypto';

import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { prisma } from '../../config/database';
import app from '../../index';
import { MINTABLE_SCOPES } from '../../middleware/token-scopes';
import {
  cleanupTestContext,
  createTestContext,
  createTestUser,
  type TestContext,
  type TestUser,
} from '../../test/factory';
import { authDel, authGet, authPatch, authPost, authPut } from '../../test/helpers';
import { addTeamMember } from '../teams/teams.service';

import { setOwners } from './service-accounts.service';

/** Every scope a bot can hold: all mintable ones but admin */
const BOT_SCOPES = MINTABLE_SCOPES.filter((s) => !s.startsWith('admin:'));

const NOTICE = 'service_account';

/**
 * A request made with an API token.
 * @param method - The HTTP method
 * @param path - The path
 * @param raw - The raw token
 */
function withToken(method: 'get' | 'post' | 'patch' | 'delete', path: string, raw: string) {
  const req = request(app)[method](path);
  return req.set('Authorization', `Token ${raw}`).set('X-Requested-With', 'XMLHttpRequest');
}

/**
 * A personal token with these scopes, stored directly.
 * @param userId - Whose token
 * @param scopes - Its scopes
 */
async function tokenOf(userId: string, scopes: string[]): Promise<string> {
  const raw = `tk_${crypto.randomBytes(24).toString('hex')}`;
  await prisma.apiToken.create({
    data: {
      userId,
      name: 'Voorbeeld agent',
      scopes,
      prefix: raw.slice(0, 11),
      tokenHash: crypto.createHash('sha256').update(raw).digest('hex'),
    },
  });
  return raw;
}

/**
 * Whether a call has settled within a time: one that waits on a lock has not.
 * @param p - The call
 * @param ms - How long to wait
 */
function settledWithin<T>(p: Promise<T>, ms: number): Promise<'settled' | 'pending'> {
  return Promise.race([
    p.then(
      () => 'settled' as const,
      () => 'settled' as const,
    ),
    new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), ms)),
  ]);
}

describe('service accounts: only where an owner is, and suspension', () => {
  let ctx: TestContext;
  let orgAdmin: TestUser;
  let teamAdmin: TestUser;
  let platformAdmin: TestUser;
  let outsider: TestUser;
  let spaceId: string;
  let pageId: string;
  let issueNumber = 7000;
  const users: string[] = [];
  const bots: string[] = [];
  let n = 0;

  /**
   * A person in the org, as MEMBER unless told otherwise, and in team A when a role is given.
   * @param teamRole - Their role in team A, or none
   * @param orgRole - Their org role
   */
  async function person(
    teamRole?: 'ADMIN' | 'MEMBER' | 'VIEWER',
    orgRole: 'OWNER' | 'ADMIN' | 'MEMBER' = 'MEMBER',
  ): Promise<TestUser> {
    const user = await createTestUser({ username: `voorbeeld-guard-${Date.now()}-${++n}` });
    users.push(user.id);
    await prisma.orgMembership.create({
      data: { orgId: ctx.orgId, userId: user.id, role: orgRole },
    });
    if (teamRole) {
      await prisma.teamMembership.create({
        data: { teamId: ctx.teamId, userId: user.id, role: teamRole },
      });
    }
    return user;
  }

  /**
   * A bot with these owners, in team A when asked, with a token.
   * @param ownerIds - Its owners
   * @param inTeam - Whether it is put in team A (as MEMBER, directly)
   */
  async function bot(ownerIds: string[], inTeam = true): Promise<{ id: string; token: string }> {
    const created = await authPost(`/api/orgs/${ctx.orgId}/service-accounts`, orgAdmin.token, {
      username: `acme-gb-${++n}-${Date.now() % 1_000_000}`,
      displayName: 'Acme guard bot',
      ownerIds,
    });
    expect(created.status).toBe(201);
    const id = created.body.id as string;
    bots.push(id);
    if (inTeam) {
      await prisma.teamMembership.create({
        data: { teamId: ctx.teamId, userId: id, role: 'MEMBER' },
      });
    }
    const token = await authPost(`/api/service-accounts/${id}/tokens`, orgAdmin.token, {
      name: 'Nightly triage',
      scopes: BOT_SCOPES,
    });
    expect(token.status).toBe(201);
    return { id, token: token.body.token };
  }

  /**
   * The bot asks to delete an issue, which waits for approval.
   * @param raw - The bot's token
   */
  async function pendingRequest(raw: string): Promise<string> {
    const number = issueNumber++;
    await prisma.issue.create({
      data: {
        projectId: ctx.projectId,
        number,
        title: 'Voorbeeld issue',
        body: '',
        creatorId: ctx.owner.id,
      },
    });
    const res = await withToken('delete', `/api/projects/${ctx.projectId}/issues/${number}`, raw);
    expect(res.status).toBe(202);
    return res.body.approvalId as string;
  }

  const account = (id: string) =>
    prisma.serviceAccount.findUniqueOrThrow({ where: { userId: id } });
  const inTeam = async (id: string) =>
    !!(await prisma.teamMembership.findFirst({ where: { teamId: ctx.teamId, userId: id } }));
  const notices = (userId: string) =>
    prisma.notification.count({ where: { userId, type: NOTICE } });
  const tokenWorks = async (raw: string) => (await withToken('get', '/api/orgs', raw)).status;

  beforeAll(async () => {
    ctx = await createTestContext('botguard');
    orgAdmin = await createTestUser({ username: 'voorbeeld-orgadmin-botguard' });
    teamAdmin = await createTestUser({ username: 'voorbeeld-teamadmin-botguard' });
    platformAdmin = await createTestUser({ username: 'voorbeeld-platform-botguard' });
    outsider = await createTestUser({ username: 'voorbeeld-outsider-botguard' });
    users.push(orgAdmin.id, teamAdmin.id, platformAdmin.id, outsider.id);
    await prisma.user.update({ where: { id: platformAdmin.id }, data: { isAdmin: true } });
    await prisma.orgMembership.createMany({
      data: [
        { orgId: ctx.orgId, userId: orgAdmin.id, role: 'ADMIN' },
        { orgId: ctx.orgId, userId: teamAdmin.id, role: 'MEMBER' },
        { orgId: ctx.orgId, userId: outsider.id, role: 'MEMBER' },
      ],
    });
    await prisma.teamMembership.create({
      data: { teamId: ctx.teamId, userId: teamAdmin.id, role: 'ADMIN' },
    });
    spaceId = (
      await prisma.wikiSpace.create({
        data: { teamId: ctx.teamId, name: 'Voorbeeld wiki', slug: 'voorbeeld-wiki-botguard' },
      })
    ).id;
    pageId = (
      await prisma.page.create({
        data: { spaceId, title: 'Voorbeeld page', slug: 'voorbeeld-page', body: 'Hallo' },
      })
    ).id;
  });

  afterAll(async () => {
    await cleanupTestContext(ctx);
    await prisma.user.deleteMany({ where: { id: { in: [...users, ...bots] } } });
  });

  // ─── Joining ─────────────────────────────────────────────

  describe('joining a team', () => {
    it('Review Focus 2: without an owner in the team it is refused and nothing changes', async () => {
      const elsewhere = await person();
      const b = await bot([elsewhere.id], false);
      const res = await authPost(`/api/teams/${ctx.teamId}/members`, teamAdmin.token, {
        userId: b.id,
        role: 'MEMBER',
      });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('SERVICE_ACCOUNT_OWNER_NOT_MEMBER');
      expect(await inTeam(b.id)).toBe(false);
    });

    it('with an owner in the team it joins', async () => {
      const owner = await person('MEMBER');
      const b = await bot([owner.id], false);
      const res = await authPost(`/api/teams/${ctx.teamId}/members`, teamAdmin.token, {
        userId: b.id,
        role: 'MEMBER',
      });
      expect(res.status).toBe(201);
      expect(await inTeam(b.id)).toBe(true);
    });

    it('a bot as team ADMIN is refused, on joining and on a role change', async () => {
      const owner = await person('MEMBER');
      const joining = await bot([owner.id], false);
      const add = await authPost(`/api/teams/${ctx.teamId}/members`, teamAdmin.token, {
        userId: joining.id,
        role: 'ADMIN',
      });
      expect(add.status).toBe(400);
      expect(add.body.error.code).toBe('SERVICE_ACCOUNT_ROLE_LIMIT');
      expect(await inTeam(joining.id)).toBe(false);

      const member = await bot([owner.id]);
      const promote = await authPatch(
        `/api/teams/${ctx.teamId}/members/${member.id}`,
        teamAdmin.token,
        { role: 'ADMIN' },
      );
      expect(promote.status).toBe(400);
      expect(promote.body.error.code).toBe('SERVICE_ACCOUNT_ROLE_LIMIT');
      const row = await prisma.teamMembership.findFirstOrThrow({
        where: { teamId: ctx.teamId, userId: member.id },
      });
      expect(row.role).toBe('MEMBER');
    });
  });

  describe('joining a space', () => {
    it('no ADMIN level for a bot', async () => {
      const owner = await person('MEMBER');
      const b = await bot([owner.id], false);
      const res = await authPut(`/api/wiki/spaces/${spaceId}/permissions`, ctx.owner.token, {
        userId: b.id,
        level: 'ADMIN',
      });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('SERVICE_ACCOUNT_ROLE_LIMIT');
    });

    it('only where an owner can view the space, also once the grant closes it', async () => {
      // A team member views an open space, but the bot's grant is its first: it closes the space
      // to everyone not listed, the owner too
      const owner = await person('MEMBER');
      const b = await bot([owner.id], false);
      const closed = await authPut(`/api/wiki/spaces/${spaceId}/permissions`, ctx.owner.token, {
        userId: b.id,
        level: 'EDIT',
      });
      expect(closed.status).toBe(400);
      expect(closed.body.error.code).toBe('SERVICE_ACCOUNT_OWNER_NOT_MEMBER');
      expect(await prisma.spacePermission.count({ where: { spaceId } })).toBe(0);

      const ownerGrant = await authPut(`/api/wiki/spaces/${spaceId}/permissions`, ctx.owner.token, {
        userId: owner.id,
        level: 'VIEW',
      });
      expect(ownerGrant.status).toBe(200);
      const res = await authPut(`/api/wiki/spaces/${spaceId}/permissions`, ctx.owner.token, {
        userId: b.id,
        level: 'EDIT',
      });
      expect(res.status).toBe(200);

      // The owner's grant goes: the owner can't view the space, so the bot's grant goes too and
      // its owner and the team's admins hear of it
      const before = await Promise.all([notices(owner.id), notices(teamAdmin.id)]);
      const removed = await authDel(
        `/api/wiki/spaces/${spaceId}/permissions/${ownerGrant.body.id}`,
        ctx.owner.token,
      );
      expect(removed.status).toBe(204);
      expect(await prisma.spacePermission.count({ where: { spaceId, userId: b.id } })).toBe(0);
      expect(await notices(owner.id)).toBe(before[0] + 1);
      expect(await notices(teamAdmin.id)).toBe(before[1] + 1);
      await prisma.spacePermission.deleteMany({ where: { spaceId } });
    });

    it('a page restriction lists a bot only where an owner can view the page', async () => {
      const owner = await person('MEMBER');
      const b = await bot([owner.id]);
      const path = `/api/wiki/pages/${pageId}/restrictions`;
      // A view restriction to the bot alone hides the page from its owner
      const alone = await authPut(path, ctx.owner.token, { type: 'VIEW', userIds: [b.id] });
      expect(alone.status).toBe(400);
      expect(alone.body.error.code).toBe('SERVICE_ACCOUNT_OWNER_NOT_MEMBER');
      expect(await prisma.pageRestriction.count({ where: { pageId } })).toBe(0);

      const both = await authPut(path, ctx.owner.token, {
        type: 'VIEW',
        userIds: [b.id, owner.id],
      });
      expect(both.status).toBe(200);
      await prisma.pageRestriction.deleteMany({ where: { pageId } });

      // An owner off the team can't view the space at all
      const elsewhere = await person();
      const off = await bot([elsewhere.id]);
      const edit = await authPut(path, ctx.owner.token, { type: 'EDIT', userIds: [off.id] });
      expect(edit.status).toBe(400);
      expect(edit.body.error.code).toBe('SERVICE_ACCOUNT_OWNER_NOT_MEMBER');
      expect(await prisma.pageRestriction.count({ where: { pageId } })).toBe(0);
    });
  });

  // ─── Owners leaving ──────────────────────────────────────

  it('the last owner in a team leaves it: the bot leaves too, and two people hear of it', async () => {
    const owner = await person('MEMBER');
    const b = await bot([owner.id]);
    const before = await Promise.all([notices(owner.id), notices(teamAdmin.id)]);
    const res = await authDel(`/api/teams/${ctx.teamId}/members/${owner.id}`, ctx.owner.token);
    expect(res.status).toBe(204);
    expect(await inTeam(b.id)).toBe(false);
    expect(await notices(owner.id)).toBe(before[0] + 1);
    expect(await notices(teamAdmin.id)).toBe(before[1] + 1);
    // Still an owner elsewhere: the bot is not suspended
    expect((await account(b.id)).status).toBe('ACTIVE');
  });

  it('another owner is still in the team: the bot stays', async () => {
    const first = await person('MEMBER');
    const second = await person('MEMBER');
    const b = await bot([first.id, second.id]);
    const res = await authDel(`/api/teams/${ctx.teamId}/members/${first.id}`, ctx.owner.token);
    expect(res.status).toBe(204);
    expect(await inTeam(b.id)).toBe(true);
  });

  it('setOwners refuses to leave a membership with no owner in it', async () => {
    const inside = await person('MEMBER');
    const outside = await person();
    const b = await bot([inside.id, outside.id]);
    const res = await authPut(`/api/service-accounts/${b.id}/owners`, orgAdmin.token, {
      ownerIds: [outside.id],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('SERVICE_ACCOUNT_OWNER_NEEDED');
    const owners = await prisma.serviceAccountOwner.count({ where: { serviceAccountId: b.id } });
    expect(owners).toBe(2);
  });

  it('removing an org member who is a bot is refused: the bot is deleted instead', async () => {
    const owner = await person('MEMBER');
    const b = await bot([owner.id]);
    const res = await authDel(`/api/orgs/${ctx.orgId}/members/${b.id}`, ctx.owner.token);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('SERVICE_ACCOUNT_MANAGED_BY_ORG');
  });

  // ─── Orphans ─────────────────────────────────────────────

  it('Review Focus 1: the last owner leaves the org with a request pending', async () => {
    const owner = await person('MEMBER');
    const b = await bot([owner.id]);
    const approvalId = await pendingRequest(b.token);
    const before = await Promise.all([notices(ctx.owner.id), notices(orgAdmin.id)]);

    const res = await authDel(`/api/orgs/${ctx.orgId}/members/${owner.id}`, ctx.owner.token);
    expect(res.status).toBe(204);

    const row = await account(b.id);
    expect(row.status).toBe('SUSPENDED');
    expect(row.suspendedReason).toBe('ORPHANED');
    expect(row.suspendedAt).not.toBeNull();
    const approval = await prisma.agentApproval.findUniqueOrThrow({ where: { id: approvalId } });
    expect(approval.status).toBe('CANCELLED');
    expect(await tokenWorks(b.token)).toBe(401);
    expect(await prisma.serviceAccountOwner.count({ where: { serviceAccountId: b.id } })).toBe(0);
    // The org's owners and admins are told
    expect(await notices(ctx.owner.id)).toBe(before[0] + 1);
    expect(await notices(orgAdmin.id)).toBe(before[1] + 1);
  });

  it('an owner leaves the org while another owner stays: the bot leaves the team they had alone', async () => {
    const leaving = await person('MEMBER');
    const staying = await person();
    const b = await bot([leaving.id, staying.id]);
    const res = await authDel(`/api/orgs/${ctx.orgId}/members/${leaving.id}`, ctx.owner.token);
    expect(res.status).toBe(204);
    expect((await account(b.id)).status).toBe('ACTIVE');
    expect(await inTeam(b.id)).toBe(false);
  });

  it('a demotion to VIEWER orphans the bot, and adding an owner resumes it', async () => {
    const owner = await person('MEMBER');
    const b = await bot([owner.id]);
    expect(await tokenWorks(b.token)).toBe(200);
    const demote = await authPatch(`/api/orgs/${ctx.orgId}/members/${owner.id}`, ctx.owner.token, {
      role: 'VIEWER',
    });
    expect(demote.status).toBe(200);
    const row = await account(b.id);
    expect(row.status).toBe('SUSPENDED');
    expect(row.suspendedReason).toBe('ORPHANED');
    expect(await tokenWorks(b.token)).toBe(401);

    // Resume refuses an orphan: it comes back with an owner
    const resume = await authPost(`/api/service-accounts/${b.id}/resume`, orgAdmin.token, {});
    expect(resume.status).toBe(400);
    expect(resume.body.error.code).toBe('SERVICE_ACCOUNT_ORPHANED');

    const next = await person('MEMBER');
    const set = await authPut(`/api/service-accounts/${b.id}/owners`, orgAdmin.token, {
      ownerIds: [next.id],
    });
    expect(set.status).toBe(200);
    const resumed = await account(b.id);
    expect(resumed.status).toBe('ACTIVE');
    expect(resumed.suspendedReason).toBeNull();
    expect(resumed.suspendedAt).toBeNull();
    expect(await tokenWorks(b.token)).toBe(200);
  });

  it('the platform admin demoting, deactivating or deleting the last owner orphans the bot', async () => {
    for (const lapse of ['demote', 'deactivate', 'delete'] as const) {
      const owner = await person('MEMBER');
      const b = await bot([owner.id]);
      const path = `/api/admin/users/${owner.id}`;
      const res =
        lapse === 'demote'
          ? await authPatch(path, platformAdmin.token, { role: 'GUEST' })
          : lapse === 'deactivate'
            ? await authPost(`${path}/deactivate`, platformAdmin.token)
            : await authDel(path, platformAdmin.token);
      expect(res.status, lapse).toBe(200);
      const row = await account(b.id);
      expect(row.status, lapse).toBe('SUSPENDED');
      expect(row.suspendedReason, lapse).toBe('ORPHANED');
      expect(await tokenWorks(b.token), lapse).toBe(401);
    }
  });

  it('an owner who no longer qualifies loses the bot at once, before any orphan check', async () => {
    const owner = await person('MEMBER');
    const b = await bot([owner.id]);
    expect((await authGet(`/api/service-accounts/${b.id}`, owner.token)).status).toBe(200);
    // Demoted behind the services' back: the owner row stays, but counts for nothing
    await prisma.orgMembership.updateMany({
      where: { orgId: ctx.orgId, userId: owner.id },
      data: { role: 'VIEWER' },
    });
    const get = await authGet(`/api/service-accounts/${b.id}`, owner.token);
    expect(get.status).toBe(404);
    expect(get.body.error.code).toBe('SERVICE_ACCOUNT_NOT_FOUND');
    const suspend = await authPost(`/api/service-accounts/${b.id}/suspend`, owner.token, {});
    expect(suspend.status).toBe(404);
    expect(suspend.body.error.code).toBe('SERVICE_ACCOUNT_NOT_FOUND');
  });

  // ─── Suspending by hand ──────────────────────────────────

  it('suspend and resume by hand: a token waits, the UI suspends, resume restores', async () => {
    const owner = await person('MEMBER');
    const b = await bot([owner.id]);
    const approvalId = await pendingRequest(b.token);

    const agent = await tokenOf(owner.id, ['orgs:write']);
    const viaToken = await withToken('post', `/api/service-accounts/${b.id}/suspend`, agent).send(
      {},
    );
    expect(viaToken.status).toBe(202);
    expect(viaToken.body.status).toBe('pending_approval');
    expect((await account(b.id)).status).toBe('ACTIVE');

    const stranger = await authPost(`/api/service-accounts/${b.id}/suspend`, outsider.token, {});
    expect(stranger.status).toBe(404);
    expect(stranger.body.error.code).toBe('SERVICE_ACCOUNT_NOT_FOUND');

    const suspend = await authPost(`/api/service-accounts/${b.id}/suspend`, owner.token, {});
    expect(suspend.status).toBe(200);
    const row = await account(b.id);
    expect(row.status).toBe('SUSPENDED');
    expect(row.suspendedReason).toBe('MANUAL');
    expect(await tokenWorks(b.token)).toBe(401);
    const approval = await prisma.agentApproval.findUniqueOrThrow({ where: { id: approvalId } });
    expect(approval.status).toBe('CANCELLED');

    const resume = await authPost(`/api/service-accounts/${b.id}/resume`, orgAdmin.token, {});
    expect(resume.status).toBe(200);
    expect(resume.body.status).toBe('ACTIVE');
    expect(await tokenWorks(b.token)).toBe(200);
  });

  // ─── Locking ─────────────────────────────────────────────

  it('setOwners waits on the bot lock and then sees the owner a concurrent leave took away', async () => {
    const inside = await person('MEMBER');
    const outside = await person();
    const b = await bot([inside.id, outside.id]);
    // Another operation holds the bot's row lock while it takes the remaining owner out of the
    // team; setOwners must wait and then read the result, not the state before it
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const isLocked = new Promise<void>((resolve) => (locked = resolve));
    const holder = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "userId" FROM service_accounts WHERE "userId" = ${b.id} FOR UPDATE`;
        locked();
        await gate;
        // The owner who would stay leaves the team, under the lock
        await tx.teamMembership.deleteMany({ where: { teamId: ctx.teamId, userId: inside.id } });
      },
      { timeout: 10_000 },
    );
    await isLocked;
    // Read before the holder commits, `inside` is still in the team and the change looks fine
    const call = setOwners(b.id, [inside.id]);
    expect(await settledWithin(call, 400)).toBe('pending');
    release();
    await holder;
    await expect(call).rejects.toMatchObject({ code: 'SERVICE_ACCOUNT_OWNER_NEEDED' });
  });

  it("adding a bot waits on the owner's membership row a concurrent leave is deleting", async () => {
    const owner = await person('MEMBER');
    const b = await bot([owner.id], false);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let deleted!: () => void;
    const isDeleted = new Promise<void>((resolve) => (deleted = resolve));
    // The owner's leave, uncommitted: its row is locked, and still there for a plain read
    const holder = prisma.$transaction(
      async (tx) => {
        await tx.teamMembership.deleteMany({ where: { teamId: ctx.teamId, userId: owner.id } });
        deleted();
        await gate;
      },
      { timeout: 10_000 },
    );
    await isDeleted;
    const call = addTeamMember(ctx.teamId, b.id, 'MEMBER');
    expect(await settledWithin(call, 400)).toBe('pending');
    release();
    await holder;
    await expect(call).rejects.toMatchObject({ code: 'SERVICE_ACCOUNT_OWNER_NOT_MEMBER' });
    expect(await inTeam(b.id)).toBe(false);
  });
});
