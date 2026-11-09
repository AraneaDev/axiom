/**
 * A bot stays only where one of its owners is (decision 9): it joins a team or a space only where
 * an owner is, in at most a member's or an editor's role, and it leaves a place when its last
 * owner there does. A bot left with no owner is suspended; owners and org admins suspend and
 * resume it by hand.
 */
import crypto from 'crypto';

import type { Prisma } from '@prisma/client';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

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
import { logger } from '../../utils/logger';
import { deleteUser } from '../admin/admin.service';
import { removeOrgMember } from '../orgs/orgs.service';
import { addTeamMember, deleteTeam } from '../teams/teams.service';

import { sweepServiceAccounts } from './bot-guards';
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
  /**
   * The token's answer: 200, or the status and code of a refusal.
   * @param raw - The token
   */
  const tokenWorks = async (raw: string) => {
    const res = await withToken('get', '/api/orgs', raw);
    return res.status === 200 ? 200 : `${res.status} ${res.body.error?.code}`;
  };
  const SUSPENDED = '401 SERVICE_ACCOUNT_SUSPENDED';
  /**
   * A new team in the org, with these people in these roles.
   * @param members - Who, in what team role
   */
  async function newTeam(members: Array<[string, 'ADMIN' | 'MEMBER' | 'VIEWER']>) {
    const tag = `${++n}-${Date.now() % 1_000_000}`;
    const team = await prisma.team.create({
      data: { orgId: ctx.orgId, name: `Voorbeeld team ${tag}`, slug: `voorbeeld-team-${tag}` },
    });
    for (const [userId, role] of members) {
      await prisma.teamMembership.create({ data: { teamId: team.id, userId, role } });
    }
    const space = await prisma.wikiSpace.create({
      data: { teamId: team.id, name: `Voorbeeld ruimte ${tag}`, slug: `voorbeeld-ruimte-${tag}` },
    });
    return { teamId: team.id, spaceId: space.id };
  }

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

  it('the last owner in a team leaves it: the bot leaves too, told only to who can open the team', async () => {
    const owner = await person('MEMBER');
    const b = await bot([owner.id]);
    const before = await Promise.all([notices(owner.id), notices(teamAdmin.id)]);
    const res = await authDel(`/api/teams/${ctx.teamId}/members/${owner.id}`, ctx.owner.token);
    expect(res.status).toBe(204);
    expect(await inTeam(b.id)).toBe(false);
    // The owner is out of the team now: the team's admin hears of it, the owner does not
    expect(await notices(owner.id)).toBe(before[0]);
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
    expect(await tokenWorks(b.token)).toBe(SUSPENDED);
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
    expect(await tokenWorks(b.token)).toBe(SUSPENDED);

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
      expect(await tokenWorks(b.token), lapse).toBe(SUSPENDED);
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
    expect(await tokenWorks(b.token)).toBe(SUSPENDED);
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

  // ─── Fix round 1 ─────────────────────────────────────────

  it('removeOrgMember takes the member row first: no deadlock with a check holding it', async () => {
    const owner = await person('MEMBER');
    await bot([owner.id]);
    const row = await prisma.orgMembership.findFirstOrThrow({
      where: { orgId: ctx.orgId, userId: owner.id },
    });
    // A bot check, in the order every check takes: the owner's org row, then their team row
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let held!: () => void;
    const isHeld = new Promise<void>((resolve) => (held = resolve));
    const check = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM org_memberships WHERE id = ${row.id} FOR SHARE`;
        held();
        await gate;
        await tx.$queryRaw`SELECT id FROM team_memberships WHERE "userId" = ${owner.id} FOR SHARE`;
      },
      { timeout: 10_000 },
    );
    await isHeld;
    const removal = removeOrgMember(ctx.orgId, owner.id);
    expect(await settledWithin(removal, 400)).toBe('pending');
    release();
    await expect(check).resolves.toBeUndefined();
    await expect(removal).resolves.toBeUndefined();
    expect(await prisma.orgMembership.count({ where: { id: row.id } })).toBe(0);
  });

  it('a manual suspension holds through an orphaning and a new owner: only resume lifts it', async () => {
    const owner = await person('MEMBER');
    const b = await bot([owner.id]);
    const suspend = await authPost(`/api/service-accounts/${b.id}/suspend`, owner.token, {});
    expect(suspend.status).toBe(200);
    const removed = await authDel(`/api/orgs/${ctx.orgId}/members/${owner.id}`, ctx.owner.token);
    expect(removed.status).toBe(204);
    const orphaned = await account(b.id);
    expect(orphaned.status).toBe('SUSPENDED');
    expect(orphaned.suspendedReason).toBe('MANUAL');

    const next = await person('MEMBER');
    const set = await authPut(`/api/service-accounts/${b.id}/owners`, orgAdmin.token, {
      ownerIds: [next.id],
    });
    expect(set.status).toBe(200);
    expect((await account(b.id)).suspendedReason).toBe('MANUAL');
    expect(await tokenWorks(b.token)).toBe(SUSPENDED);

    const resume = await authPost(`/api/service-accounts/${b.id}/resume`, next.token, {});
    expect(resume.status).toBe(200);
    expect(await tokenWorks(b.token)).toBe(200);
  });

  it('decision 13: a team-role grant the owner is below takes the bot out of the team', async () => {
    const owner = await person();
    const b = await bot([owner.id], false);
    // The owner is a team VIEWER, the bot a MEMBER: the space is open, both see it
    const { teamId, spaceId: roleSpace } = await newTeam([
      [owner.id, 'VIEWER'],
      [b.id, 'MEMBER'],
    ]);
    const grant = await authPut(`/api/wiki/spaces/${roleSpace}/permissions`, ctx.owner.token, {
      teamRole: 'MEMBER',
      level: 'EDIT',
    });
    expect(grant.status).toBe(200);
    // Now only MEMBERs open the space: the bot would, its owner can't
    expect(await prisma.teamMembership.count({ where: { teamId, userId: b.id } })).toBe(0);

    const add = await authPost(`/api/teams/${teamId}/members`, ctx.owner.token, {
      userId: b.id,
      role: 'MEMBER',
    });
    expect(add.status).toBe(400);
    expect(add.body.error.code).toBe('SERVICE_ACCOUNT_OWNER_NOT_MEMBER');
    expect(await prisma.teamMembership.count({ where: { teamId, userId: b.id } })).toBe(0);
  });

  it("an owner's lower team role takes the bot out of a space only that role opened", async () => {
    const owner = await person();
    const b = await bot([owner.id], false);
    const { teamId, spaceId: s } = await newTeam([[owner.id, 'MEMBER']]);
    await prisma.spacePermission.create({
      data: { spaceId: s, teamRole: 'MEMBER', level: 'VIEW' },
    });
    const grant = await authPut(`/api/wiki/spaces/${s}/permissions`, ctx.owner.token, {
      userId: b.id,
      level: 'EDIT',
    });
    expect(grant.status).toBe(200);
    const before = await notices(owner.id);
    const demote = await authPatch(`/api/teams/${teamId}/members/${owner.id}`, ctx.owner.token, {
      role: 'VIEWER',
    });
    expect(demote.status).toBe(200);
    expect(await prisma.spacePermission.count({ where: { spaceId: s, userId: b.id } })).toBe(0);
    // The owner can't open the space anymore, so isn't told its name
    expect(await notices(owner.id)).toBe(before);
  });

  it('an org ADMIN owner made MEMBER takes the bot out of a space only that role opened', async () => {
    const owner = await person(undefined, 'ADMIN');
    const b = await bot([owner.id], false);
    const { spaceId: s } = await newTeam([]);
    await prisma.spacePermission.create({ data: { spaceId: s, teamRole: 'ADMIN', level: 'VIEW' } });
    const grant = await authPut(`/api/wiki/spaces/${s}/permissions`, ctx.owner.token, {
      userId: b.id,
      level: 'EDIT',
    });
    expect(grant.status).toBe(200);
    const demote = await authPatch(`/api/orgs/${ctx.orgId}/members/${owner.id}`, ctx.owner.token, {
      role: 'MEMBER',
    });
    expect(demote.status).toBe(200);
    expect(await prisma.spacePermission.count({ where: { spaceId: s, userId: b.id } })).toBe(0);
    expect((await account(b.id)).status).toBe('ACTIVE');
  });

  it("a page's new view list that leaves the owner out takes the bot off the page", async () => {
    const owner = await person('MEMBER');
    const b = await bot([owner.id]);
    const page = await prisma.page.create({
      data: { spaceId, title: 'Voorbeeld lijst', slug: `voorbeeld-lijst-${++n}`, body: 'Hallo' },
    });
    const path = `/api/wiki/pages/${page.id}/restrictions`;
    const edit = await authPut(path, ctx.owner.token, { type: 'EDIT', userIds: [b.id] });
    expect(edit.status).toBe(200);
    const view = await authPut(path, ctx.owner.token, { type: 'VIEW', userIds: [teamAdmin.id] });
    expect(view.status).toBe(200);
    expect(await prisma.pageRestriction.count({ where: { pageId: page.id, userId: b.id } })).toBe(
      0,
    );
  });

  // ─── Fix round 2 ─────────────────────────────────────────

  it('owner rows lock in one order: an OWNER co-owner sorting after the removed member', async () => {
    const [first, second] = [await person(), await person()];
    const [x, a] = first.id < second.id ? [first, second] : [second, first];
    await prisma.orgMembership.updateMany({
      where: { orgId: ctx.orgId, userId: a.id },
      data: { role: 'OWNER' },
    });
    const b = await bot([x.id, a.id], false);
    const rowA = await prisma.orgMembership.findFirstOrThrow({
      where: { orgId: ctx.orgId, userId: a.id },
    });
    // Something holds A's row, so the removal of X queues on the org's OWNER rows first
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let held!: () => void;
    const isHeld = new Promise<void>((resolve) => (held = resolve));
    const holder = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM org_memberships WHERE id = ${rowA.id} FOR UPDATE`;
        held();
        await gate;
      },
      { timeout: 10_000 },
    );
    await isHeld;
    const removal = removeOrgMember(ctx.orgId, x.id);
    expect(await settledWithin(removal, 300)).toBe('pending');
    // A bot check on both owners: taking X before A would hold X while the removal holds A
    const check = setOwners(b.id, [x.id, a.id]);
    expect(await settledWithin(check, 300)).toBe('pending');
    release();
    await holder;
    await expect(removal).resolves.toBeUndefined();
    // The check ran after the removal: X is no owner anymore
    await expect(check).rejects.toMatchObject({ code: 'SERVICE_ACCOUNT_OWNER_INVALID' });
  });

  it('deleting the last owner of a manually suspended bot tells the org owners and admins', async () => {
    const owner = await person('MEMBER');
    const b = await bot([owner.id]);
    const suspend = await authPost(`/api/service-accounts/${b.id}/suspend`, owner.token, {});
    expect(suspend.status).toBe(200);
    const before = await Promise.all([notices(ctx.owner.id), notices(orgAdmin.id)]);
    const res = await authDel(`/api/admin/users/${owner.id}`, platformAdmin.token);
    expect(res.status).toBe(200);
    const row = await account(b.id);
    expect(row.status).toBe('SUSPENDED');
    expect(row.suspendedReason).toBe('MANUAL');
    expect(await notices(ctx.owner.id)).toBe(before[0] + 1);
    expect(await notices(orgAdmin.id)).toBe(before[1] + 1);
  });
  // ─── Final fix wave ──────────────────────────────────────

  /**
   * Hold a row lock until released, in a transaction of its own.
   * @param lock - Takes the lock
   */
  async function holdLock(lock: (tx: Prisma.TransactionClient) => Promise<unknown>) {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let held!: () => void;
    const isHeld = new Promise<void>((resolve) => (held = resolve));
    const holder = prisma.$transaction(
      async (tx) => {
        await lock(tx);
        held();
        await gate;
      },
      { timeout: 10_000 },
    );
    await isHeld;
    return {
      release: async () => {
        release();
        await holder;
      },
    };
  }

  it('I1: deleting the person who made and owns a bot takes the bot row before the cascade', async () => {
    const creator = await person('MEMBER', 'ADMIN');
    const created = await authPost(`/api/orgs/${ctx.orgId}/service-accounts`, creator.token, {
      username: `acme-gb-${++n}-${Date.now() % 1_000_000}`,
      displayName: 'Acme creator bot',
      ownerIds: [creator.id],
    });
    expect(created.status).toBe(201);
    const id = created.body.id as string;
    bots.push(id);
    const row = await prisma.orgMembership.findFirstOrThrow({
      where: { orgId: ctx.orgId, userId: creator.id },
    });
    // Something holds the creator's org row: the delete queues on it first
    const lock = await holdLock(
      (tx) => tx.$queryRaw`SELECT id FROM org_memberships WHERE id = ${row.id} FOR UPDATE`,
    );
    const removal = deleteUser(creator.id);
    expect(await settledWithin(removal, 300)).toBe('pending');
    // A bot check holds the bot row and waits on the owner's org row the delete holds next
    const check = setOwners(id, [creator.id]);
    expect(await settledWithin(check, 300)).toBe('pending');
    await lock.release();
    await expect(removal).resolves.toEqual({ deleted: true });
    // The check ran after the delete: the creator is no owner anymore
    await expect(check).rejects.toMatchObject({ code: 'SERVICE_ACCOUNT_OWNER_INVALID' });
    expect((await account(id)).createdById).toBeNull();
  });

  it("M2: deleting a team takes the rows of the team's bots first", async () => {
    const owner = await person();
    const b = await bot([owner.id], false);
    const { teamId } = await newTeam([
      [owner.id, 'MEMBER'],
      [b.id, 'MEMBER'],
    ]);
    const lock = await holdLock(
      (tx) =>
        tx.$queryRaw`SELECT "userId" FROM service_accounts WHERE "userId" = ${b.id} FOR UPDATE`,
    );
    const removal = deleteTeam(teamId);
    expect(await settledWithin(removal, 300)).toBe('pending');
    await lock.release();
    await expect(removal).resolves.toBeUndefined();
    expect(await prisma.team.count({ where: { id: teamId } })).toBe(0);
  });

  it('I2: suspending an orphan by hand holds through a new owner: only resume lifts it', async () => {
    const owner = await person('MEMBER');
    const b = await bot([owner.id]);
    const removed = await authDel(`/api/orgs/${ctx.orgId}/members/${owner.id}`, ctx.owner.token);
    expect(removed.status).toBe(204);
    expect((await account(b.id)).suspendedReason).toBe('ORPHANED');
    const orphanedAt = (await account(b.id)).suspendedAt;

    const suspend = await authPost(`/api/service-accounts/${b.id}/suspend`, orgAdmin.token, {});
    expect(suspend.status).toBe(200);
    expect(suspend.body.suspendedReason).toBe('MANUAL');
    expect((await account(b.id)).suspendedAt).toEqual(orphanedAt);

    const next = await person('MEMBER');
    const set = await authPut(`/api/service-accounts/${b.id}/owners`, orgAdmin.token, {
      ownerIds: [next.id],
    });
    expect(set.status).toBe(200);
    const row = await account(b.id);
    expect(row.status).toBe('SUSPENDED');
    expect(row.suspendedReason).toBe('MANUAL');
    expect(await tokenWorks(b.token)).toBe(SUSPENDED);

    const resume = await authPost(`/api/service-accounts/${b.id}/resume`, orgAdmin.token, {});
    expect(resume.status).toBe(200);
    expect(await tokenWorks(b.token)).toBe(200);
  });

  it('M1: resume refuses a bot left in a place none of its owners can open', async () => {
    const owner = await person('MEMBER');
    const b = await bot([owner.id]);
    const suspend = await authPost(`/api/service-accounts/${b.id}/suspend`, owner.token, {});
    expect(suspend.status).toBe(200);
    // A hook that failed while it was suspended left it in a team its owner is not in
    const { teamId } = await newTeam([]);
    await prisma.teamMembership.create({ data: { teamId, userId: b.id, role: 'MEMBER' } });

    const resume = await authPost(`/api/service-accounts/${b.id}/resume`, owner.token, {});
    expect(resume.status).toBe(400);
    expect(resume.body.error.code).toBe('SERVICE_ACCOUNT_OWNER_NEEDED');
    expect((await account(b.id)).status).toBe('SUSPENDED');
    expect(await tokenWorks(b.token)).toBe(SUSPENDED);
  });

  it('an after-commit hook that fails leaves the change standing, logs, and the sweep repairs', async () => {
    const owner = await person('MEMBER');
    const b = await bot([owner.id]);
    const logged = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const findMany = prisma.serviceAccountOwner.findMany.bind(prisma.serviceAccountOwner);
    // The hook's first read of the owner's bots fails, as a dropped connection would
    const forced = vi
      .spyOn(prisma.serviceAccountOwner, 'findMany')
      .mockImplementation(((args: Parameters<typeof findMany>[0]) =>
        args?.where?.ownerId === owner.id
          ? Promise.reject(new Error('forced hook failure'))
          : findMany(args)) as never);
    try {
      const res = await authDel(`/api/teams/${ctx.teamId}/members/${owner.id}`, teamAdmin.token);
      expect(res.status).toBe(204);
    } finally {
      forced.mockRestore();
    }
    expect(
      await prisma.teamMembership.count({ where: { teamId: ctx.teamId, userId: owner.id } }),
    ).toBe(0);
    expect(logged).toHaveBeenCalledWith(
      'a service account check failed; the sweep repairs it',
      { what: `owner ${owner.id}` },
      expect.objectContaining({ message: 'forced hook failure' }),
    );
    logged.mockRestore();
    // The hook did not run: the bot is still in the team, until the sweep
    expect(await inTeam(b.id)).toBe(true);
    await sweepServiceAccounts();
    expect(await inTeam(b.id)).toBe(false);
    expect((await account(b.id)).status).toBe('ACTIVE');
  });
});
