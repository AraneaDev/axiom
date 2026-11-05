/**
 * Org and user approval policies on top of the defaults: an org may loosen or tighten, a user may
 * only tighten, an admin action always waits, and only an org owner changes the org's rules.
 */
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { PendingApproval } from '../../actions/approval-policy';
import { defineAction, type ActionContext } from '../../actions/define';
import { executeAction } from '../../actions/execute';
import { registerActions } from '../../actions/registry';
import { dashboardUpdate } from '../../actions/sharing-previews';
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
import { logger } from '../../utils/logger';

import { describePolicyChange, effectivePolicy, writeActionNames } from './agent-policy.service';

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
  let ownerToken: string;

  /**
   * A token's context for a user.
   * @param user - The user
   */
  function asToken(user: TestUser): ActionContext {
    return {
      userId: user.id,
      channel: 'rest-token',
      apiTokenId: 'policy-t',
      scopes: ['issues:write', 'approvals:write', 'dashboards:write', 'files:write'],
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
    ownerToken = await tokenHeaderFor(ctx.owner, undefined, 'policy-owner');
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
    it('logs nothing for an org that has no policy row', async () => {
      const spy = vi.spyOn(logger, 'error');
      try {
        await prisma.agentPolicy.deleteMany({ where: { orgId: ctx.orgId } });
        await effectivePolicy(ctx.owner.id, [ctx.orgId]);
        expect(spy).not.toHaveBeenCalled();
      } finally {
        spy.mockRestore();
      }
    });

    it('still logs a row that no longer fits the schema', async () => {
      const spy = vi.spyOn(logger, 'error').mockImplementation(() => logger);
      try {
        await setOrg(ctx.orgId, { requireFor: 'nonsense' });
        await effectivePolicy(ctx.owner.id, [ctx.orgId]);
        expect(spy).toHaveBeenCalledTimes(1);
      } finally {
        spy.mockRestore();
        await prisma.agentPolicy.deleteMany({ where: { orgId: ctx.orgId } });
      }
    });

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

  describe('actions whose input names no org', () => {
    /**
     * A dashboard of the owner.
     * @param shared - Shared with the org, or private
     */
    async function dashboard(shared: boolean) {
      return prisma.dashboard.create({
        data: {
          name: 'Policy board',
          ownerId: ctx.owner.id,
          visibility: shared ? 'ORG' : 'PRIVATE',
          orgId: shared ? ctx.orgId : null,
        },
      });
    }

    it('binds dashboard.update, widgets and savedQuery.update to the org it is shared with', async () => {
      const board = await dashboard(true);
      const saved = await prisma.savedFilter.create({
        data: {
          userId: ctx.owner.id,
          name: 'Policy query',
          query: {},
          visibility: 'ORG',
          orgId: ctx.orgId,
        },
      });
      await setOrg(ctx.orgId, {
        alsoRequire: ['dashboard.update', 'dashboardWidget.reorder', 'savedQuery.update'],
      });
      expect(await waits('dashboard.update', { id: board.id, name: 'Renamed' })).toBe(true);
      expect(await waits('dashboardWidget.reorder', { id: board.id, widgetIds: ['w1'] })).toBe(
        true,
      );
      expect(await waits('savedQuery.update', { filterId: saved.id, name: 'Renamed' })).toBe(true);
      const after = await prisma.dashboard.findUniqueOrThrow({ where: { id: board.id } });
      expect(after.name).toBe('Policy board');
      await prisma.dashboard.delete({ where: { id: board.id } });
      await prisma.savedFilter.delete({ where: { id: saved.id } });
    });

    it('lets an org loosen dashboard.delete, but not for a private dashboard', async () => {
      await setOrg(ctx.orgId, { destructive: false });
      const shared = await dashboard(true);
      expect(await waits('dashboard.delete', { id: shared.id })).toBe(false);
      const priv = await dashboard(false);
      expect(await waits('dashboard.delete', { id: priv.id })).toBe(true);
      await prisma.dashboard.delete({ where: { id: priv.id } });
    });

    it('binds an upload by issue key and the org of the issue it goes to', async () => {
      const issue = await prisma.issue.create({
        data: {
          projectId: ctx.projectId,
          number: 4200,
          title: 'Upload target',
          body: '',
          creatorId: ctx.owner.id,
        },
      });
      await setOrg(ctx.orgId, { alsoRequire: ['attachment.createUploadUrl'] });
      const file = { filename: 'a.png', mimeType: 'image/png', size: 8 };
      const key = `${ctx.projectPrefix}-${issue.number}`;
      const res = await request(app)
        .post('/api/act')
        .set('Authorization', ownerToken)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          action: 'attachment.createUploadUrl',
          input: { ...file, target: { issueKey: key } },
        });
      expect(res.status).toBe(202);
      const staged = await request(app)
        .post('/api/act')
        .set('Authorization', ownerToken)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ action: 'attachment.createUploadUrl', input: file });
      // A staged file attaches later, wherever the user can, so every org of theirs binds it
      expect(staged.status).toBe(202);
      await prisma.agentPolicy.deleteMany({ where: { orgId: ctx.orgId } });
      const free = await request(app)
        .post('/api/act')
        .set('Authorization', ownerToken)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ action: 'attachment.createUploadUrl', input: file });
      expect(free.status).toBe(200);
    });

    it('binds an action named by key and one inside a batch', async () => {
      const issue = await prisma.issue.create({
        data: {
          projectId: ctx.projectId,
          number: 4201,
          title: 'Key target',
          body: '',
          creatorId: ctx.owner.id,
        },
      });
      await setOrg(ctx.orgId, { alsoRequire: ['issue.update'] });
      const key = `${ctx.projectPrefix}-${issue.number}`;
      const post = (body: object) =>
        request(app)
          .post('/api/act')
          .set('Authorization', ownerToken)
          .set('X-Requested-With', 'XMLHttpRequest')
          .send(body);
      const single = await post({ action: 'issue.update', key, input: { title: 'By key' } });
      expect(single.status).toBe(202);
      const batch = await post({
        batch: [{ action: 'issue.update', key, input: { title: 'In batch' } }],
      });
      expect(batch.body.results[0]).toMatchObject({ pending: true });
      const after = await prisma.issue.findUniqueOrThrow({ where: { id: issue.id } });
      expect(after.title).toBe('Key target');
    });

    it('binds pageTemplate.resolve to the org of its space', async () => {
      const space = await prisma.wikiSpace.create({
        data: {
          teamId: ctx.teamId,
          name: 'Policy space',
          slug: 'policy-space',
        },
      });
      await setOrg(ctx.orgId, { alsoRequire: ['pageTemplate.resolve'] });
      const wikiCtx = { ...tokenCtx, scopes: ['wiki:write'] };
      expect(
        await waits('pageTemplate.resolve', { body: 'x', context: { spaceId: space.id } }, wikiCtx),
      ).toBe(true);
      await prisma.wikiSpace.delete({ where: { id: space.id } });
    });
  });

  describe('a change of sharing is a permission change', () => {
    it('makes dashboard.update wait when it reshares, whatever the orgs say, and lets a rename pass', async () => {
      const second = await prisma.organization.create({
        data: { name: 'Second org', slug: `second-${Date.now()}` },
      });
      await prisma.orgMembership.create({
        data: { userId: ctx.owner.id, orgId: second.id, role: 'OWNER' },
      });
      await setOrg(second.id, { destructive: false });
      const board = await prisma.dashboard.create({
        data: { name: 'Shared board', ownerId: ctx.owner.id, visibility: 'ORG', orgId: ctx.orgId },
      });
      // Escape 1: move it under the loose org, then delete it without approval
      expect(
        await waits('dashboard.update', { id: board.id, visibility: 'ORG', orgId: second.id }),
      ).toBe(true);
      expect(await waits('dashboard.update', { id: board.id, visibility: 'PRIVATE' })).toBe(true);
      const unchanged = await prisma.dashboard.findUniqueOrThrow({ where: { id: board.id } });
      expect(unchanged).toMatchObject({ visibility: 'ORG', orgId: ctx.orgId });
      expect(await waits('dashboard.delete', { id: board.id })).toBe(true);
      expect(await prisma.dashboard.count({ where: { id: board.id } })).toBe(1);
      // Escape 2: out of the org that lists a widget action, add, and back
      await setOrg(ctx.orgId, { alsoRequire: ['dashboardWidget.add'] });
      expect(await waits('dashboard.update', { id: board.id, visibility: 'PRIVATE' })).toBe(true);
      // A rename is no permission change
      expect(await waits('dashboard.update', { id: board.id, name: 'Renamed' })).toBe(false);
      await prisma.dashboard.delete({ where: { id: board.id } });
      await prisma.organization.delete({ where: { id: second.id } });
    });

    it('does the same for savedQuery.update', async () => {
      const saved = await prisma.savedFilter.create({
        data: {
          userId: ctx.owner.id,
          name: 'Shared query',
          query: {},
          visibility: 'ORG',
          orgId: ctx.orgId,
        },
      });
      expect(await waits('savedQuery.update', { filterId: saved.id, visibility: 'PRIVATE' })).toBe(
        true,
      );
      expect(await waits('savedQuery.update', { filterId: saved.id, orgId: otherOrg.orgId })).toBe(
        true,
      );
      expect(await waits('savedQuery.update', { filterId: saved.id, name: 'Renamed' })).toBe(false);
      await prisma.savedFilter.delete({ where: { id: saved.id } });
    });
  });

  describe('raw actions named in a rule', () => {
    const file = { filename: 'a.png', mimeType: 'image/png', size: 8 };

    it('accepts attachment.upload in alsoRequire, and no other raw name', async () => {
      const ok = await authPut('/api/agent-policy', ctx.owner.token, {
        scope: 'org',
        orgId: ctx.orgId,
        rules: { alsoRequire: ['attachment.upload'] },
      });
      expect(ok.status).toBe(200);
      const bad = await authPut('/api/agent-policy', ctx.owner.token, {
        scope: 'org',
        orgId: ctx.orgId,
        rules: { alsoRequire: ['attachment.download'] },
      });
      expect(bad.status).toBe(400);
    });

    it('refuses a token the upload with 403 naming the rule, not a session', async () => {
      await setOrg(ctx.orgId, { alsoRequire: ['attachment.upload'] });
      const res = await request(app)
        .post('/api/attachments')
        .set('Authorization', ownerToken)
        .set('X-Requested-With', 'XMLHttpRequest')
        .attach('file', Buffer.from('hello'), 'hello.txt');
      expect(res.status).toBe(403);
      expect(res.body.error.message).toContain('alsoRequire');
      const session = await request(app)
        .post('/api/attachments')
        .set('Authorization', `Bearer ${ctx.owner.token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .attach('file', Buffer.from('hello'), 'hello.txt');
      // Not refused by the rule (storing the file is the upload tests' concern)
      expect(session.status).not.toBe(403);
    });

    it('says an update that sets nothing does nothing', async () => {
      const made = await request(app)
        .post('/api/dashboards')
        .set('Authorization', `Bearer ${ctx.owner.token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ name: 'Nothing to set' });
      expect(made.status).toBe(201);
      const text = await dashboardUpdate(ctx.owner.id, made.body.id, {});
      expect(text).toContain('Nothing to set');
      expect(text).toMatch(/nothing/i);
      expect(text).not.toMatch(/set $/);
    });

    it("tells a stranger nothing of a foreign org's rule on a multipart upload", async () => {
      const foreign = await prisma.issue.create({
        data: {
          projectId: otherOrg.projectId,
          number: 4399,
          title: 'Foreign',
          body: '',
          creatorId: otherOrg.owner.id,
        },
      });
      const upload = () =>
        request(app)
          .post('/api/attachments')
          .set('Authorization', ownerToken)
          .set('X-Requested-With', 'XMLHttpRequest')
          .field('issueId', foreign.id)
          .attach('file', Buffer.from('hello'), 'hello.txt');
      const without = await upload();
      await setOrg(otherOrg.orgId, { alsoRequire: ['attachment.upload'] });
      const withRule = await upload();
      expect(withRule.status).toBe(without.status);
      expect(withRule.body).toEqual(without.body);
      expect(JSON.stringify(withRule.body)).not.toContain('alsoRequire');
    });

    it('binds a multipart upload by the org of its parent, and a staged one by every org', async () => {
      await setOrg(ctx.orgId, { alsoRequire: ['attachment.upload'] });
      const mine = await prisma.issue.create({
        data: {
          projectId: ctx.projectId,
          number: 4300,
          title: 'Mine',
          body: '',
          creatorId: ctx.owner.id,
        },
      });
      const elsewhere = await prisma.issue.create({
        data: {
          projectId: otherOrg.projectId,
          number: 4301,
          title: 'Elsewhere',
          body: '',
          creatorId: otherOrg.owner.id,
        },
      });
      const post = (fields: Record<string, string>) => {
        const req = request(app)
          .post('/api/attachments')
          .set('Authorization', ownerToken)
          .set('X-Requested-With', 'XMLHttpRequest');
        for (const [key, value] of Object.entries(fields)) req.field(key, value);
        return req.attach('file', Buffer.from('hello'), 'hello.txt');
      };
      const bound = await post({ issueId: mine.id });
      expect(bound.status).toBe(403);
      expect(bound.body.error.message).toContain('alsoRequire');
      const staged = await post({});
      expect(staged.status).toBe(403);
      expect(staged.body.error.message).toContain('alsoRequire');
      // An issue of an org without the rule is not bound by this org's rule
      const other = await post({ issueId: elsewhere.id });
      expect(other.body.error?.message ?? '').not.toContain('alsoRequire');
    });

    it('lets a staged upload through when no rule names the upload', async () => {
      await setOrg(ctx.orgId, { destructive: false });
      const res = await request(app)
        .post('/api/act')
        .set('Authorization', ownerToken)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ action: 'attachment.createUploadUrl', input: file });
      expect(res.status).toBe(200);
    });
  });

  describe('what a waiting update says', () => {
    it('names each field a rename or query change sets and speaks of sharing only when it changes', async () => {
      const board = await prisma.dashboard.create({
        data: { name: 'Plain board', ownerId: ctx.owner.id, visibility: 'ORG', orgId: ctx.orgId },
      });
      const saved = await prisma.savedFilter.create({
        data: {
          userId: ctx.owner.id,
          name: 'Plain query',
          query: {},
          visibility: 'ORG',
          orgId: ctx.orgId,
        },
      });
      await setOrg(ctx.orgId, { alsoRequire: ['dashboard.update', 'savedQuery.update'] });
      const previewOf = async (name: string, input: object) => {
        const result = await executeAction(name, input, tokenCtx);
        expect(result).toBeInstanceOf(PendingApproval);
        return (result as PendingApproval).body.preview;
      };
      const rename = await previewOf('dashboard.update', {
        id: board.id,
        name: 'Ransom',
        description: 'x',
      });
      expect(rename).toContain('the name to "Ransom"');
      expect(rename).toContain('the description to "x"');
      expect(rename).not.toContain('unchanged');
      expect(rename).not.toContain('who can open it');
      const both = await previewOf('dashboard.update', {
        id: board.id,
        name: 'Ransom',
        visibility: 'PRIVATE',
      });
      expect(both).toContain('the name to "Ransom"');
      expect(both).toContain('who can open it');
      const query = await previewOf('savedQuery.update', {
        filterId: saved.id,
        text: 'type = Task',
      });
      expect(query).toContain('the query to "type = Task"');
      expect(query).not.toContain('who can open it');
      await prisma.dashboard.delete({ where: { id: board.id } });
      await prisma.savedFilter.delete({ where: { id: saved.id } });
    });

    it('says a flag turned back on is stricter', async () => {
      await setOrg(ctx.orgId, { destructive: false, crossContainerMove: false });
      const text = await describePolicyChange(ctx.owner.id, 'org', ctx.orgId, {});
      expect(text).toContain('Stricter: deletes need approval again');
      expect(text).toContain('moves between projects or spaces need approval again');
      expect(text).not.toContain('Stricter: deletes need no approval');
    });
  });

  describe('names are checked before a request is made', () => {
    it('answers 400 to a token with invented names, and queues nothing', async () => {
      const res = await request(app)
        .put('/api/agent-policy')
        .set('Authorization', ownerToken)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ scope: 'org', orgId: ctx.orgId, rules: { alsoRequire: ['no.such.action'] } });
      expect(res.status).toBe(400);
      const user = await request(app)
        .put('/api/agent-policy')
        .set('Authorization', ownerToken)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ scope: 'user', rules: { destructive: false } });
      expect(user.status).toBe(400);
      expect(await prisma.agentApproval.count({ where: { userId: ctx.owner.id } })).toBe(0);
    });
  });

  describe('names in org rules', () => {
    it('refuses a misspelt, a read, a uiOnly and a raw name, and exempting an admin action', async () => {
      for (const rules of [
        { alsoRequire: ['isue.delete'] },
        { alsoRequire: ['issue.list'] },
        { neverRequire: ['nope'] },
        { neverRequire: ['agentPolicy.update'] },
      ]) {
        const res = await authPut('/api/agent-policy', ctx.owner.token, {
          scope: 'org',
          orgId: ctx.orgId,
          rules,
        });
        expect(res.status, JSON.stringify(rules)).toBe(400);
      }
    });
  });

  describe('the preview of a rule change', () => {
    it('names the org, leads with what gets looser and is not moved by padding', async () => {
      const org = await prisma.organization.findUniqueOrThrow({ where: { id: ctx.orgId } });
      const padding = writeActionNames().filter((name) => name !== 'issue.delete');
      const text = await describePolicyChange(ctx.owner.id, 'org', ctx.orgId, {
        destructive: false,
        neverRequire: ['issue.delete'],
        alsoRequire: padding,
      });
      expect(text).toContain(org.name);
      expect(text).toContain(org.slug);
      expect(text.indexOf('issue.delete')).toBeGreaterThan(-1);
      expect(text.indexOf('issue.delete')).toBeLessThan(400);
      expect(text).toContain('deletes need no approval');
      expect(text).toContain('Stricter:');
      expect(text).toContain('Replace all approval rules');
    });

    it('says nothing gets looser when it only tightens', async () => {
      const text = await describePolicyChange(ctx.owner.id, 'org', ctx.orgId, { bulkOver: 3 });
      expect(text).toContain('Nothing gets looser');
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
