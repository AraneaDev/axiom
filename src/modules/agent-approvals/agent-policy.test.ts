/**
 * Org and user approval policies on top of the defaults: an org may loosen or tighten, a user may
 * only tighten, an admin action always waits, and only an org owner changes the org's rules.
 */
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { PendingApproval } from '../../actions/approval-policy';
import { defineAction, type ActionContext } from '../../actions/define';
import { executeAction } from '../../actions/execute';
import { registerActions } from '../../actions/registry';
import { prisma } from '../../config/database';
import app from '../../index';
import {
  addMemberToContext,
  cleanupTestContext,
  createTestContext,
  createTestUser,
  type TestContext,
  type TestUser,
} from '../../test/factory';
import { authGet, authPut } from '../../test/helpers';
import { tokenHeaderFor } from '../../test/mcp-client';

import { effectivePolicy } from './agent-policy.service';

const runs: string[] = [];

registerActions([
  defineAction({
    name: 'policyTest.destroy',
    destructive: true,
    area: 'issues',
    kind: 'write',
    summary: 'A destructive test action on a project',
    input: z.object({ projectId: z.string() }),
    output: z.looseObject({ id: z.string() }),
    authorize: () => Promise.resolve(),
    handler: () => {
      runs.push('destroy');
      return Promise.resolve({ id: 'gone' });
    },
  }),
  defineAction({
    name: 'policyTest.admin',
    admin: true,
    area: 'issues',
    kind: 'write',
    summary: 'An admin test action on a project',
    input: z.object({ projectId: z.string() }),
    output: z.looseObject({ id: z.string() }),
    authorize: () => Promise.resolve(),
    handler: () => {
      runs.push('admin');
      return Promise.resolve({ id: 'done' });
    },
  }),
  defineAction({
    name: 'policyTest.bulk',
    area: 'issues',
    kind: 'write',
    summary: 'A bulk test action',
    input: z.object({ projectId: z.string(), items: z.array(z.string()) }),
    output: z.looseObject({ id: z.string() }),
    bulkCount: ({ items }) => items.length,
    authorize: () => Promise.resolve(),
    handler: () => {
      runs.push('bulk');
      return Promise.resolve({ id: 'done' });
    },
  }),
  defineAction({
    name: 'policyTest.free',
    area: 'issues',
    kind: 'write',
    summary: 'A test action that needs no approval by default',
    input: z.object({ projectId: z.string() }),
    output: z.looseObject({ id: z.string() }),
    authorize: () => Promise.resolve(),
    handler: () => {
      runs.push('free');
      return Promise.resolve({ id: 'done' });
    },
  }),
]);

describe('agent policies', () => {
  let ctx: TestContext;
  let member: TestUser;
  let stranger: TestUser;
  let otherOrg: TestContext;
  let tokenCtx: ActionContext;
  let memberCtx: ActionContext;
  let memberToken: string;

  /**
   * A token's context for a user.
   * @param user - The user
   */
  function asToken(user: TestUser): ActionContext {
    return {
      userId: user.id,
      channel: 'rest-token',
      apiTokenId: 'policy-t',
      scopes: ['issues:write', 'approvals:write'],
    };
  }

  /**
   * Run an action as a token and say whether it waited.
   * @param name - The action
   * @param input - Its input
   * @param as - The caller
   */
  async function waits(name: string, input: unknown, as: ActionContext = tokenCtx) {
    const result = await executeAction(name, input, as);
    return result instanceof PendingApproval;
  }

  beforeAll(async () => {
    ctx = await createTestContext('agent-policy');
    otherOrg = await createTestContext('agent-policy-other');
    member = await addMemberToContext(ctx);
    stranger = await createTestUser();
    tokenCtx = asToken(ctx.owner);
    memberCtx = asToken(member);
    memberToken = await tokenHeaderFor(member, undefined, 'policy-member');
  });

  beforeEach(async () => {
    runs.length = 0;
    await prisma.agentPolicy.deleteMany({
      where: {
        OR: [
          { orgId: { in: [ctx.orgId, otherOrg.orgId] } },
          { userId: { in: [ctx.owner.id, member.id, stranger.id] } },
        ],
      },
    });
    await prisma.agentApproval.deleteMany({
      where: { userId: { in: [ctx.owner.id, member.id] } },
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [member.id, stranger.id] } } });
    await cleanupTestContext(otherOrg);
    await cleanupTestContext(ctx);
  });

  const setOrg = (orgId: string, rules: object) =>
    prisma.agentPolicy.upsert({ where: { orgId }, create: { orgId, rules }, update: { rules } });
  const setUser = (userId: string, rules: object) =>
    prisma.agentPolicy.upsert({ where: { userId }, create: { userId, rules }, update: { rules } });

  describe('layers', () => {
    it('holds the defaults when nothing is set', async () => {
      const policy = await effectivePolicy(ctx.owner.id, [ctx.orgId]);
      expect(policy.requireFor).toEqual({
        destructive: true,
        admin: true,
        bulkOver: 10,
        crossContainerMove: true,
      });
      expect(policy.expiresMinutes).toBe(60);
      expect(await waits('policyTest.destroy', { projectId: ctx.projectId })).toBe(true);
    });

    it('lets an org loosen destructive, so a token delete runs without approval', async () => {
      await setOrg(ctx.orgId, { destructive: false });
      expect(await waits('policyTest.destroy', { projectId: ctx.projectId })).toBe(false);
      expect(runs).toEqual(['destroy']);
    });

    it('lets an org tighten bulkOver and expiry', async () => {
      await setOrg(ctx.orgId, { bulkOver: 2, expiresMinutes: 15 });
      const result = (await executeAction(
        'policyTest.bulk',
        { projectId: ctx.projectId, items: ['a', 'b', 'c'] },
        tokenCtx,
      )) as PendingApproval;
      expect(result).toBeInstanceOf(PendingApproval);
      const row = await prisma.agentApproval.findUniqueOrThrow({
        where: { id: result.body.approvalId },
      });
      const minutes = (row.expiresAt.getTime() - row.createdAt.getTime()) / 60_000;
      expect(Math.round(minutes)).toBe(15);
    });

    it('applies the org of the project the call names, not another', async () => {
      await setOrg(otherOrg.orgId, { destructive: false });
      expect(await waits('policyTest.destroy', { projectId: ctx.projectId })).toBe(true);
      expect(await waits('policyTest.destroy', { projectId: otherOrg.projectId })).toBe(false);
    });

    it('uses defaults plus user rules when no org is named', async () => {
      await setOrg(ctx.orgId, { destructive: false });
      const policy = await effectivePolicy(ctx.owner.id, []);
      expect(policy.requireFor.destructive).toBe(true);
    });

    it('takes the strictest of several orgs', async () => {
      await setOrg(ctx.orgId, { destructive: false, bulkOver: 50 });
      await setOrg(otherOrg.orgId, { bulkOver: 5 });
      const policy = await effectivePolicy(ctx.owner.id, [ctx.orgId, otherOrg.orgId]);
      expect(policy.requireFor.destructive).toBe(true);
      expect(policy.requireFor.bulkOver).toBe(5);
    });

    it('keeps an exemption only where every org grants it', async () => {
      await setOrg(ctx.orgId, { neverRequire: ['policyTest.free', 'policyTest.destroy'] });
      await setOrg(otherOrg.orgId, { neverRequire: ['policyTest.free'] });
      const policy = await effectivePolicy(ctx.owner.id, [ctx.orgId, otherOrg.orgId]);
      expect(policy.neverRequire).toEqual(['policyTest.free']);
    });

    it('lets an org exempt a named destructive action', async () => {
      await setOrg(ctx.orgId, { neverRequire: ['policyTest.destroy'] });
      expect(await waits('policyTest.destroy', { projectId: ctx.projectId })).toBe(false);
    });
  });

  describe('user rules', () => {
    it('makes a token status change wait when the user lists issue.update', async () => {
      const issue = await prisma.issue.create({
        data: {
          projectId: ctx.projectId,
          number: 4100,
          title: 'Policy target',
          body: '',
          creatorId: ctx.owner.id,
        },
      });
      const input = { projectId: ctx.projectId, issueNumber: issue.number, title: 'Renamed' };
      expect(await waits('issue.update', input)).toBe(false);
      await setUser(ctx.owner.id, { alsoRequire: ['issue.update'] });
      expect(await waits('issue.update', input)).toBe(true);
      const after = await prisma.issue.findUniqueOrThrow({ where: { id: issue.id } });
      expect(after.title).toBe('Renamed');
    });

    it('lets a user lower bulkOver but never raise what an org set', async () => {
      await setOrg(ctx.orgId, { bulkOver: 4 });
      await setUser(ctx.owner.id, { bulkOver: 2 });
      expect((await effectivePolicy(ctx.owner.id, [ctx.orgId])).requireFor.bulkOver).toBe(2);
      // A stored row that loosens (written around the API) is ignored
      await setUser(ctx.owner.id, { bulkOver: 30, destructive: false, neverRequire: ['x'] });
      const policy = await effectivePolicy(ctx.owner.id, [ctx.orgId]);
      expect(policy.requireFor.bulkOver).toBe(4);
      expect(policy.requireFor.destructive).toBe(true);
      expect(policy.neverRequire).toEqual([]);
    });

    it('does not let a user rule cancel an org exemption of another name', async () => {
      await setOrg(ctx.orgId, { neverRequire: ['policyTest.destroy'] });
      await setUser(ctx.owner.id, { alsoRequire: ['policyTest.destroy'] });
      expect(await waits('policyTest.destroy', { projectId: ctx.projectId })).toBe(true);
    });
  });

  describe('admin actions', () => {
    it('still waits when the org exempts it and loosens everything', async () => {
      await setOrg(ctx.orgId, {
        destructive: false,
        bulkOver: 1000,
        crossContainerMove: false,
        neverRequire: ['policyTest.admin'],
      });
      expect(await waits('policyTest.admin', { projectId: ctx.projectId })).toBe(true);
      expect(runs).toEqual([]);
    });
  });

  describe('agentPolicy.update and get over REST', () => {
    it('refuses a user rule that loosens, with 400', async () => {
      for (const rules of [
        { destructive: false },
        { crossContainerMove: false },
        { bulkOver: 11 },
        { expiresMinutes: 61 },
        { neverRequire: ['issue.update'] },
        { alsoRequire: ['no.such.action'] },
        { alsoRequire: ['issue.list'] },
        { unknownField: true },
      ]) {
        const res = await authPut('/api/agent-policy', ctx.owner.token, { scope: 'user', rules });
        expect(res.status, JSON.stringify(rules)).toBe(400);
      }
      expect(await prisma.agentPolicy.count({ where: { userId: ctx.owner.id } })).toBe(0);
    });

    it('saves tightening user rules and reads them back with the effective policy', async () => {
      const rules = { bulkOver: 3, expiresMinutes: 30, alsoRequire: ['issue.update'] };
      const saved = await authPut('/api/agent-policy', ctx.owner.token, { scope: 'user', rules });
      expect(saved.status).toBe(200);
      const res = await authGet('/api/agent-policy?scope=user', ctx.owner.token);
      expect(res.status).toBe(200);
      expect(res.body.rules).toEqual(rules);
      expect(res.body.effective.requireFor.bulkOver).toBe(3);
      expect(res.body.effective.expiresMinutes).toBe(30);
      expect(res.body.effective.alsoRequire).toEqual(['issue.update']);
      expect(res.body.defaults.requireFor.bulkOver).toBe(10);
      expect(res.body.writeActions).toContain('issue.update');
    });

    it('lets an org owner set org rules and refuses expiry outside 10 to 1440', async () => {
      const ok = await authPut('/api/agent-policy', ctx.owner.token, {
        scope: 'org',
        orgId: ctx.orgId,
        rules: { destructive: false, expiresMinutes: 1440, neverRequire: ['policyTest.destroy'] },
      });
      expect(ok.status).toBe(200);
      expect(ok.body.effective.requireFor.destructive).toBe(false);
      for (const expiresMinutes of [9, 1441]) {
        const res = await authPut('/api/agent-policy', ctx.owner.token, {
          scope: 'org',
          orgId: ctx.orgId,
          rules: { expiresMinutes },
        });
        expect(res.status).toBe(400);
      }
    });

    it('refuses a member who is not an owner, and a stranger, to change org rules', async () => {
      const body = { scope: 'org', orgId: ctx.orgId, rules: { destructive: false } };
      expect((await authPut('/api/agent-policy', member.token, body)).status).toBe(403);
      expect((await authPut('/api/agent-policy', stranger.token, body)).status).toBe(403);
      expect(await prisma.agentPolicy.count({ where: { orgId: ctx.orgId } })).toBe(0);
    });

    it('lets a member read the org rules and refuses a stranger', async () => {
      await setOrg(ctx.orgId, { bulkOver: 7 });
      const path = `/api/agent-policy?scope=org&orgId=${ctx.orgId}`;
      const read = await authGet(path, member.token);
      expect(read.status).toBe(200);
      expect(read.body.effective.requireFor.bulkOver).toBe(7);
      expect((await authGet(path, stranger.token)).status).toBe(403);
    });

    it('needs orgId for scope org', async () => {
      expect((await authGet('/api/agent-policy?scope=org', ctx.owner.token)).status).toBe(400);
    });

    it('makes a token wait to change rules, user rules included (A13)', async () => {
      const res = await request(app)
        .put('/api/agent-policy')
        .set('Authorization', memberToken)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ scope: 'user', rules: { bulkOver: 3 } });
      expect(res.status).toBe(202);
      expect(res.body.status).toBe('pending_approval');
      expect(await prisma.agentPolicy.count({ where: { userId: member.id } })).toBe(0);
      expect(await waits('agentPolicy.update', { scope: 'user', rules: {} }, memberCtx)).toBe(true);
    });

    it('lets a token read its rules', async () => {
      const res = await request(app)
        .get('/api/agent-policy?scope=user')
        .set('Authorization', memberToken);
      expect(res.status).toBe(200);
    });
  });
});
