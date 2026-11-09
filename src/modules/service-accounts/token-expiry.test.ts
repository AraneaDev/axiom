/**
 * The worker's service account job: owners hear once when a bot token is two weeks from expiry
 * (decision 7), and the hourly sweep repairs what a failed hook left (decisions 8, 9 and 13).
 */
import crypto from 'crypto';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { prisma } from '../../config/database';
import {
  cleanupTestContext,
  createTestContext,
  createTestUser,
  type TestContext,
  type TestUser,
} from '../../test/factory';
import { authPost } from '../../test/helpers';

import { sweepServiceAccounts } from './bot-guards';
import { notifyExpiringBotTokens } from './token-expiry.job';

const NOTICE = 'service_account';
const DAY_MS = 24 * 60 * 60 * 1000;

describe('service accounts: the worker job', () => {
  let ctx: TestContext;
  let orgAdmin: TestUser;
  const users: string[] = [];
  const bots: string[] = [];
  let n = 0;

  /**
   * A person in the org, as MEMBER, and in team A when asked.
   * @param inTeam - Whether they join team A
   */
  async function person(inTeam = true): Promise<TestUser> {
    const user = await createTestUser({ username: `voorbeeld-expiry-${Date.now()}-${++n}` });
    users.push(user.id);
    await prisma.orgMembership.create({
      data: { orgId: ctx.orgId, userId: user.id, role: 'MEMBER' },
    });
    if (inTeam) {
      await prisma.teamMembership.create({
        data: { teamId: ctx.teamId, userId: user.id, role: 'MEMBER' },
      });
    }
    return user;
  }

  /**
   * A bot with these owners.
   * @param ownerIds - Its owners
   */
  async function bot(ownerIds: string[]): Promise<string> {
    const created = await authPost(`/api/orgs/${ctx.orgId}/service-accounts`, orgAdmin.token, {
      username: `acme-expiry-${++n}-${Date.now() % 1_000_000}`,
      displayName: 'Acme expiry bot',
      ownerIds,
    });
    expect(created.status).toBe(201);
    bots.push(created.body.id);
    return created.body.id as string;
  }

  /**
   * A token stored directly, expiring some days from now.
   * @param userId - Whose token
   * @param days - Days until it expires
   */
  async function tokenExpiringIn(userId: string, days: number): Promise<string> {
    const raw = `tk_${crypto.randomBytes(24).toString('hex')}`;
    const token = await prisma.apiToken.create({
      data: {
        userId,
        name: 'Nightly triage',
        scopes: ['issues:read'],
        prefix: raw.slice(0, 11),
        tokenHash: crypto.createHash('sha256').update(raw).digest('hex'),
        expiresAt: new Date(Date.now() + days * DAY_MS),
      },
    });
    return token.id;
  }

  const notices = (userId: string) =>
    prisma.notification.count({ where: { userId, type: NOTICE, title: { contains: 'expires' } } });

  beforeAll(async () => {
    ctx = await createTestContext('botexpiry');
    orgAdmin = await createTestUser({ username: 'voorbeeld-orgadmin-botexpiry' });
    users.push(orgAdmin.id);
    await prisma.orgMembership.create({
      data: { orgId: ctx.orgId, userId: orgAdmin.id, role: 'ADMIN' },
    });
  });

  afterAll(async () => {
    await cleanupTestContext(ctx);
    await prisma.user.deleteMany({ where: { id: { in: [...users, ...bots] } } });
  });

  describe('token expiry notices', () => {
    it('a bot token 13 days from expiry notifies both owners once, and a second run nobody', async () => {
      const [a, b] = [await person(), await person()];
      const id = await bot([a.id, b.id]);
      const tokenId = await tokenExpiringIn(id, 13);

      await notifyExpiringBotTokens();
      expect(await notices(a.id)).toBe(1);
      expect(await notices(b.id)).toBe(1);
      const token = await prisma.apiToken.findUniqueOrThrow({ where: { id: tokenId } });
      expect(token.expiryNotifiedAt).not.toBeNull();

      await notifyExpiringBotTokens();
      expect(await notices(a.id)).toBe(1);
      expect(await notices(b.id)).toBe(1);
    });

    it('a token 20 days out notifies nobody', async () => {
      const owner = await person();
      const id = await bot([owner.id]);
      const tokenId = await tokenExpiringIn(id, 20);
      await notifyExpiringBotTokens();
      expect(await notices(owner.id)).toBe(0);
      const token = await prisma.apiToken.findUniqueOrThrow({ where: { id: tokenId } });
      expect(token.expiryNotifiedAt).toBeNull();
    });

    it("a person's agent token is ignored", async () => {
      const agent = await person();
      const tokenId = await tokenExpiringIn(agent.id, 13);
      await notifyExpiringBotTokens();
      expect(await notices(agent.id)).toBe(0);
      const token = await prisma.apiToken.findUniqueOrThrow({ where: { id: tokenId } });
      expect(token.expiryNotifiedAt).toBeNull();
    });

    it('a rotated token, ending in its grace week, notifies nobody', async () => {
      const owner = await person();
      const id = await bot([owner.id]);
      const tokenId = await tokenExpiringIn(id, 5);
      await prisma.apiToken.update({ where: { id: tokenId }, data: { rotatedAt: new Date() } });
      await notifyExpiringBotTokens();
      expect(await notices(owner.id)).toBe(0);
    });
  });

  describe('the hourly sweep', () => {
    it('takes a bot out of a team none of its owners is in, and keeps it active', async () => {
      const owner = await person(false);
      const id = await bot([owner.id]);
      // Written past the guards, as a failed hook would leave it
      await prisma.teamMembership.create({
        data: { teamId: ctx.teamId, userId: id, role: 'MEMBER' },
      });

      await sweepServiceAccounts();
      expect(await prisma.teamMembership.count({ where: { teamId: ctx.teamId, userId: id } })).toBe(
        0,
      );
      const account = await prisma.serviceAccount.findUniqueOrThrow({ where: { userId: id } });
      expect(account.status).toBe('ACTIVE');
    });

    it('suspends a bot whose only owner lapsed, and drops the lapsed owner', async () => {
      const owner = await person();
      const id = await bot([owner.id]);
      // A demotion whose hook never ran
      await prisma.orgMembership.update({
        where: { userId_orgId: { userId: owner.id, orgId: ctx.orgId } },
        data: { role: 'VIEWER' },
      });

      await sweepServiceAccounts();
      const account = await prisma.serviceAccount.findUniqueOrThrow({ where: { userId: id } });
      expect(account.status).toBe('SUSPENDED');
      expect(account.suspendedReason).toBe('ORPHANED');
      expect(await prisma.serviceAccountOwner.count({ where: { serviceAccountId: id } })).toBe(0);
    });

    it('leaves a bot whose owners are where it is alone', async () => {
      const owner = await person();
      const id = await bot([owner.id]);
      await prisma.teamMembership.create({
        data: { teamId: ctx.teamId, userId: id, role: 'MEMBER' },
      });
      await sweepServiceAccounts();
      expect(await prisma.teamMembership.count({ where: { teamId: ctx.teamId, userId: id } })).toBe(
        1,
      );
      const account = await prisma.serviceAccount.findUniqueOrThrow({ where: { userId: id } });
      expect(account.status).toBe('ACTIVE');
      expect(await prisma.serviceAccountOwner.count({ where: { serviceAccountId: id } })).toBe(1);
    });
  });
});
