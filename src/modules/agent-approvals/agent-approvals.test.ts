/**
 * The approval gate over REST, /api/act and MCP: a token's call that needs approval waits, only a
 * person in the web UI decides, and the action then runs with what that person's agent may do at
 * that moment.
 */
import { createServer, Server } from 'http';
import { AddressInfo } from 'net';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import WebSocket, { WebSocketServer } from 'ws';
import { z } from 'zod';

import { defineAction } from '../../actions/define';
import { executeAction } from '../../actions/execute';
import { registerActions } from '../../actions/registry';
import { prisma } from '../../config/database';
import app from '../../index';
import { createAgentServer } from '../../mcp/agent-server';
import { createWebSocketServer } from '../../realtime/ws-server';
import { tokenFor, waitFor } from '../../test/collab-client';
import {
  addMemberToContext,
  cleanupTestContext,
  createTestContext,
  createTestUser,
  type TestContext,
  type TestUser,
} from '../../test/factory';
import { authGet, authPost } from '../../test/helpers';
import { callTool, connectMcp, serveApp, tokenHeaderFor } from '../../test/mcp-client';

import { clearDecidedAgentApprovals, expireAgentApprovals } from './agent-approvals.cleanup';

const runs: string[] = [];

registerActions([
  defineAction({
    name: 'approvalTest.gated',
    destructive: true,
    area: 'issues',
    kind: 'write',
    summary: 'A gated test action',
    input: z.object({ value: z.string().optional() }),
    output: z.looseObject({ id: z.string() }),
    preview: (_ctx, { value }) => Promise.resolve(`Run the test action on ${value ?? 'nothing'}`),
    redactResult: (result) => ({ id: (result as { id: string }).id }),
    authorize: () => Promise.resolve(),
    handler: (_ctx, { value }) => {
      runs.push(value ?? '');
      return Promise.resolve({ id: 'done', secret: 'raw-secret' });
    },
  }),
  defineAction({
    name: 'approvalTest.plain',
    destructive: true,
    area: 'issues',
    kind: 'write',
    summary: 'A gated test action without a preview',
    input: z.object({ value: z.string() }),
    output: z.looseObject({ id: z.string() }),
    authorize: () => Promise.resolve(),
    handler: () => Promise.resolve({ id: 'x'.repeat(1024 * 1024 + 1) }),
  }),
  defineAction({
    name: 'approvalTest.free',
    area: 'issues',
    kind: 'write',
    summary: 'A test action that needs no approval',
    input: z.object({ value: z.string() }),
    output: z.looseObject({ value: z.string() }),
    authorize: () => Promise.resolve(),
    handler: (_ctx, { value }) => {
      runs.push(value);
      return Promise.resolve({ value });
    },
  }),
]);

describe('agent approvals', () => {
  let ctx: TestContext;
  let member: TestUser;
  let other: TestUser;
  let owner: TestUser;
  let ownerToken: string;
  let memberToken: string;
  let nextNumber = 1000;

  beforeAll(async () => {
    ctx = await createTestContext('agent-approvals');
    owner = ctx.owner;
    member = await addMemberToContext(ctx);
    other = await createTestUser();
    ownerToken = await tokenHeaderFor(owner, undefined, 'owner-agent');
    memberToken = await tokenHeaderFor(member, undefined, 'member-agent');
  });

  beforeEach(async () => {
    runs.length = 0;
    await prisma.agentApproval.deleteMany({
      where: { userId: { in: [owner.id, member.id, other.id] } },
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [member.id, other.id] } } });
    await cleanupTestContext(ctx);
  });

  /**
   * Make an issue directly.
   * @param title - Its title
   */
  async function createIssue(title = 'Target issue') {
    const number = nextNumber++;
    const issue = await prisma.issue.create({
      data: { projectId: ctx.projectId, number, title, body: '', creatorId: owner.id },
    });
    return { id: issue.id, number };
  }

  /**
   * Delete an issue over REST.
   * @param number - The issue's number
   * @param header - The Authorization header
   */
  function deleteIssue(number: number, header: string) {
    return request(app)
      .delete(`/api/projects/${ctx.projectId}/issues/${number}`)
      .set('Authorization', header)
      .set('X-Requested-With', 'XMLHttpRequest');
  }

  /**
   * POST /api/act with a header.
   * @param header - The Authorization header
   * @param body - The request
   */
  function act(header: string, body: object) {
    return request(app)
      .post('/api/act')
      .set('Authorization', header)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send(body);
  }

  /**
   * A pending gated test action.
   * @param value - Its input
   * @param header - Whose token asks
   * @returns The approval's id
   */
  async function pendingOn(value: string, header = ownerToken): Promise<string> {
    const res = await act(header, { action: 'approvalTest.gated', input: { value } });
    expect(res.status).toBe(202);
    return res.body.approvalId as string;
  }

  /**
   * Approve in the web UI.
   * @param id - The approval
   * @param user - Who decides
   */
  function approve(id: string, user: TestUser = owner) {
    return authPost(`/api/agent-approvals/${id}/approve`, user.token);
  }

  describe('the gate', () => {
    it('answers a token DELETE with 202 and deletes nothing', async () => {
      const issue = await createIssue();
      const res = await deleteIssue(issue.number, ownerToken);
      expect(res.status).toBe(202);
      expect(res.body).toMatchObject({
        status: 'pending_approval',
        approvalId: expect.any(String),
        preview: expect.stringContaining(`${ctx.projectPrefix}-${issue.number}`),
        expiresAt: expect.any(String),
        approveUrl: `/approvals/agent/${res.body.approvalId}`,
      });
      expect(res.body.next).toContain('approvals:read');
      expect(await prisma.issue.findUnique({ where: { id: issue.id } })).not.toBeNull();
      const row = await prisma.agentApproval.findUniqueOrThrow({
        where: { id: res.body.approvalId },
      });
      expect(row).toMatchObject({
        status: 'PENDING',
        userId: owner.id,
        action: 'issue.delete',
        apiTokenName: 'owner-agent',
        channel: 'rest-token',
      });
      const hours = (row.expiresAt.getTime() - row.createdAt.getTime()) / 3_600_000;
      expect(hours).toBeCloseTo(1, 1);
    });

    it('lets a browser DELETE run directly', async () => {
      const issue = await createIssue();
      const res = await deleteIssue(issue.number, `Bearer ${owner.token}`);
      expect(res.status).toBe(204);
      expect(await prisma.issue.findUnique({ where: { id: issue.id } })).toBeNull();
      expect(await prisma.agentApproval.count({ where: { userId: owner.id } })).toBe(0);
    });

    it('creates no approval for what the caller may not reach', async () => {
      const issue = await createIssue();
      const strangerToken = await tokenHeaderFor(other, undefined, 'stranger-agent');
      const byPath = await deleteIssue(issue.number, strangerToken);
      expect(byPath.status).toBe(403);
      const byKey = await act(strangerToken, {
        action: 'issue.delete',
        key: `${ctx.projectPrefix}-${issue.number}`,
      });
      expect(byKey.status).toBe(404);
      expect(await prisma.agentApproval.count({ where: { userId: other.id } })).toBe(0);
    });

    it('creates no approval for an item that does not exist', async () => {
      const res = await deleteIssue(999_999, ownerToken);
      expect(res.status).toBe(404);
      expect(await prisma.agentApproval.count({ where: { userId: owner.id } })).toBe(0);
    });

    it('lets a call that needs no approval run', async () => {
      const res = await act(ownerToken, { action: 'approvalTest.free', input: { value: 'a' } });
      expect(res.status).toBe(200);
      expect(runs).toEqual(['a']);
    });

    it('stores only the fields the action takes', async () => {
      const issue = await createIssue();
      const res = await request(app)
        .delete(`/api/projects/${ctx.projectId}/issues/${issue.number}?extra=1`)
        .set('Authorization', ownerToken)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ junk: 'left out' });
      const row = await prisma.agentApproval.findUniqueOrThrow({
        where: { id: res.body.approvalId },
      });
      expect(row.input).toEqual({
        projectId: ctx.projectId,
        issueNumber: String(issue.number),
      });
    });

    it('says in the preview that the subtasks of an issue stay', async () => {
      const parent = await createIssue('Parent issue');
      const child = await createIssue('Child issue');
      await prisma.issue.update({ where: { id: child.id }, data: { parentId: parent.id } });
      const res = await deleteIssue(parent.number, ownerToken);
      expect(res.body.preview).toBe(
        `Delete ${ctx.projectPrefix}-${parent.number}: Parent issue ` +
          '(its 1 subtask stays, without a parent)',
      );
      await approve(res.body.approvalId);
      const kept = await prisma.issue.findUniqueOrThrow({ where: { id: child.id } });
      expect(kept.parentId).toBeNull();
    });

    it('names the page and its space in the preview, and keeps the page until approved', async () => {
      const space = await prisma.wikiSpace.create({
        data: { name: 'Handbook', slug: `approvals-${Date.now()}`, teamId: ctx.teamId },
      });
      const page = await prisma.page.create({
        data: {
          spaceId: space.id,
          title: 'Onboarding',
          slug: 'onboarding',
          body: '',
        },
      });
      const res = await request(app)
        .delete(`/api/wiki/spaces/${space.id}/pages/onboarding`)
        .set('Authorization', ownerToken)
        .set('X-Requested-With', 'XMLHttpRequest');
      expect(res.status).toBe(202);
      expect(res.body.preview).toBe('Delete the page Onboarding in Handbook');
      expect(await prisma.page.findUnique({ where: { id: page.id } })).not.toBeNull();
      expect((await approve(res.body.approvalId)).body.status).toBe('EXECUTED');
      expect(await prisma.page.findUnique({ where: { id: page.id } })).toBeNull();
    });

    it('falls back to the summary and the input for a preview', async () => {
      const res = await act(ownerToken, { action: 'approvalTest.plain', input: { value: 'v' } });
      expect(res.body.preview).toBe('A gated test action without a preview: {"value":"v"}');
    });

    it('caps the preview, however long the input', async () => {
      const res = await act(ownerToken, {
        action: 'approvalTest.plain',
        input: { value: 'v'.repeat(5000) },
      });
      expect(res.status).toBe(202);
      expect(res.body.preview.length).toBeLessThanOrEqual(2000);
      const note = await prisma.notification.findFirstOrThrow({
        where: { userId: owner.id, link: res.body.approveUrl },
      });
      expect(note.title.length).toBeLessThanOrEqual(300);
    });

    it('refuses an input over 256 KB with 400', async () => {
      const res = await act(ownerToken, {
        action: 'approvalTest.gated',
        input: { value: 'v'.repeat(257 * 1024) },
      });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INPUT_TOO_LARGE');
    });

    it('refuses the 51st pending request with 429, also in parallel', async () => {
      const expiresAt = new Date(Date.now() + 3_600_000);
      await prisma.agentApproval.createMany({
        data: Array.from({ length: 49 }, () => ({
          userId: owner.id,
          action: 'approvalTest.gated',
          input: {},
          preview: 'Seeded',
          channel: 'rest-token',
          expiresAt,
        })),
      });
      const answers = await Promise.all(
        Array.from({ length: 4 }, (_, i) =>
          act(ownerToken, { action: 'approvalTest.gated', input: { value: String(i) } }),
        ),
      );
      expect(answers.map((res) => res.status).sort()).toEqual([202, 429, 429, 429]);
      expect(await prisma.agentApproval.count({ where: { userId: owner.id } })).toBe(50);
    });
  });

  describe('the bypass', () => {
    /**
     * An APPROVED row a caller might try to spend.
     * @param action - Its action
     */
    async function approvedRow(action = 'approvalTest.gated'): Promise<string> {
      const row = await prisma.agentApproval.create({
        data: {
          userId: owner.id,
          action,
          input: {},
          preview: 'Approved earlier',
          channel: 'rest-token',
          status: 'APPROVED',
          expiresAt: new Date(Date.now() + 3_600_000),
        },
      });
      return row.id;
    }

    it('cannot come in through REST', async () => {
      const id = await approvedRow('issue.delete');
      const issue = await createIssue();
      const res = await request(app)
        .delete(`/api/projects/${ctx.projectId}/issues/${issue.number}?approvalBypass=${id}`)
        .set('Authorization', ownerToken)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ approvalBypass: id });
      expect(res.status).toBe(202);
      expect(await prisma.issue.findUnique({ where: { id: issue.id } })).not.toBeNull();
    });

    it('cannot come in through act', async () => {
      const id = await approvedRow();
      const res = await act(ownerToken, {
        action: 'approvalTest.gated',
        input: { value: 'x', approvalBypass: id },
      });
      expect(res.status).toBe(400);
      expect(runs).toEqual([]);
    });

    it('cannot come in through MCP', async () => {
      const id = await approvedRow();
      const served = await serveApp();
      const client = await connectMcp(served.base, ownerToken);
      try {
        const answer = await callTool(client, 'act', {
          action: 'approvalTest.gated',
          input: { value: 'x', approvalBypass: id },
        });
        expect(answer.isError).toBe(true);
        expect(answer.data.status).toBe(400);
        expect(runs).toEqual([]);
      } finally {
        await client.close();
        await served.close();
      }
    });

    it('cannot come in through the context', async () => {
      const id = await approvedRow();
      const token = await prisma.apiToken.findFirstOrThrow({ where: { userId: owner.id } });
      const result = await executeAction('approvalTest.gated', { value: 'x' }, {
        userId: owner.id,
        apiTokenId: token.id,
        scopes: token.scopes,
        channel: 'rest-token',
        approvalBypass: id,
      } as never);
      expect((result as { body: { status: string } }).body.status).toBe('pending_approval');
      expect(runs).toEqual([]);
    });
  });

  describe('approving', () => {
    it('runs the action once, as the token that asked', async () => {
      const issue = await createIssue();
      const pending = await deleteIssue(issue.number, ownerToken);
      const res = await approve(pending.body.approvalId);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('EXECUTED');
      expect(await prisma.issue.findUnique({ where: { id: issue.id } })).toBeNull();

      const again = await approve(pending.body.approvalId);
      expect(again.status).toBe(409);

      const row = await prisma.agentApproval.findUniqueOrThrow({
        where: { id: pending.body.approvalId },
      });
      expect(row.status).toBe('EXECUTED');
      expect(row.decidedAt).not.toBeNull();
    });

    it('audits the run with the channel and the token, so it says via', async () => {
      const issue = await createIssue();
      const pending = await deleteIssue(issue.number, ownerToken);
      await approve(pending.body.approvalId);
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { userId: owner.id, action: 'issue.delete' },
        orderBy: { createdAt: 'desc' },
      });
      expect(audit.via).toBe('owner-agent');
      expect(audit.details).toMatchObject({ channel: 'rest-token', outcome: 'ok' });
    });

    it('writes a pending row in the audit log, not a done one', async () => {
      const id = await pendingOn('audited');
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { userId: owner.id, action: 'approvalTest.gated' },
        orderBy: { createdAt: 'desc' },
      });
      expect(audit.details).toMatchObject({ outcome: 'pending_approval', approvalId: id });
    });

    it('runs once when approved twice in parallel', async () => {
      const id = await pendingOn('parallel');
      const answers = await Promise.all([approve(id), approve(id), approve(id)]);
      expect(answers.map((res) => res.status).sort()).toEqual([200, 409, 409]);
      expect(runs).toEqual(['parallel']);
    });

    it('fails with 403 when the role was revoked since', async () => {
      const issue = await createIssue();
      const pending = await deleteIssue(issue.number, memberToken);
      expect(pending.status).toBe(202);
      await prisma.teamMembership.updateMany({
        where: { teamId: ctx.teamId, userId: member.id },
        data: { role: 'VIEWER' },
      });
      try {
        const res = await approve(pending.body.approvalId, member);
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('FAILED');
        expect(res.body.error.status).toBe(403);
        expect(await prisma.issue.findUnique({ where: { id: issue.id } })).not.toBeNull();
      } finally {
        await prisma.teamMembership.updateMany({
          where: { teamId: ctx.teamId, userId: member.id },
          data: { role: 'MEMBER' },
        });
      }
    });

    it('fails with 403 when the token was revoked since', async () => {
      const header = await tokenHeaderFor(owner, undefined, 'short-lived');
      const id = await pendingOn('revoked', header);
      await prisma.apiToken.deleteMany({ where: { userId: owner.id, name: 'short-lived' } });
      const res = await approve(id);
      expect(res.body.status).toBe('FAILED');
      expect(res.body.error.status).toBe(403);
      expect(runs).toEqual([]);
    });

    it('fails with 403 when the token has expired since', async () => {
      const header = await tokenHeaderFor(owner, undefined, 'expiring');
      const id = await pendingOn('expired', header);
      await prisma.apiToken.updateMany({
        where: { userId: owner.id, name: 'expiring' },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      const res = await approve(id);
      expect(res.body.status).toBe('FAILED');
      expect(res.body.error.status).toBe(403);
      expect(runs).toEqual([]);
    });

    it('reads the scopes of the token at approval', async () => {
      const header = await tokenHeaderFor(owner, undefined, 'narrowed');
      const id = await pendingOn('narrowed', header);
      await prisma.apiToken.updateMany({
        where: { userId: owner.id, name: 'narrowed' },
        data: { scopes: ['wiki:read'] },
      });
      const res = await approve(id);
      expect(res.body.status).toBe('FAILED');
      expect(res.body.error.status).toBe(403);
      expect(runs).toEqual([]);
    });

    it('answers 404 to another user and leaves the request waiting', async () => {
      const id = await pendingOn('theirs');
      const res = await approve(id, member);
      expect(res.status).toBe(404);
      const row = await prisma.agentApproval.findUniqueOrThrow({ where: { id } });
      expect(row.status).toBe('PENDING');
      expect(runs).toEqual([]);
    });

    it('refuses a token with 403, whatever its scopes', async () => {
      const id = await pendingOn('own');
      const res = await request(app)
        .post(`/api/agent-approvals/${id}/approve`)
        .set('Authorization', ownerToken)
        .set('X-Requested-With', 'XMLHttpRequest');
      expect(res.status).toBe(403);
      const viaAct = await act(ownerToken, { action: 'agentApproval.approve', input: { id } });
      expect(viaAct.status).toBe(403);
      expect(runs).toEqual([]);
    });

    it('keeps a secret out of the row and out of wait, and gives it to the approver', async () => {
      const id = await pendingOn('secret');
      const res = await approve(id);
      expect(res.body.result).toMatchObject({ id: 'done', secret: 'raw-secret' });
      const row = await prisma.agentApproval.findUniqueOrThrow({ where: { id } });
      expect(row.result).toEqual({ id: 'done' });
      const waited = await request(app)
        .get(`/api/agent-approvals/${id}/wait`)
        .set('Authorization', ownerToken);
      expect(JSON.stringify(waited.body)).not.toContain('raw-secret');
    });

    it('fails with a clear message when the result is over 1 MB', async () => {
      const pending = await act(ownerToken, {
        action: 'approvalTest.plain',
        input: { value: 'big' },
      });
      const res = await approve(pending.body.approvalId);
      expect(res.body.status).toBe('FAILED');
      expect(res.body.error.code).toBe('RESULT_TOO_LARGE');
      expect(res.body.error.message).toContain('ran');
      const row = await prisma.agentApproval.findUniqueOrThrow({
        where: { id: pending.body.approvalId },
      });
      expect(row.result).toBeNull();
    });
  });

  describe('rejecting', () => {
    it('never runs the action', async () => {
      const id = await pendingOn('rejected');
      const res = await authPost(`/api/agent-approvals/${id}/reject`, owner.token);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('REJECTED');
      expect((await approve(id)).status).toBe(409);
      expect(runs).toEqual([]);
    });

    it('answers 404 to another user and 403 to a token', async () => {
      const id = await pendingOn('kept');
      const stranger = await authPost(`/api/agent-approvals/${id}/reject`, member.token);
      expect(stranger.status).toBe(404);
      const viaToken = await request(app)
        .post(`/api/agent-approvals/${id}/reject`)
        .set('Authorization', ownerToken)
        .set('X-Requested-With', 'XMLHttpRequest');
      expect(viaToken.status).toBe(403);
    });
  });

  describe('expiry', () => {
    /**
     * Put a request past its expiry.
     * @param id - The approval
     */
    async function pastExpiry(id: string): Promise<void> {
      await prisma.agentApproval.update({
        where: { id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
    }

    it('marks past requests EXPIRED in the worker job, and leaves the rest', async () => {
      const gone = await pendingOn('gone');
      const live = await pendingOn('live');
      await pastExpiry(gone);
      await expireAgentApprovals();
      const row = await prisma.agentApproval.findUniqueOrThrow({ where: { id: gone } });
      expect(row.status).toBe('EXPIRED');
      expect(row.decidedAt).not.toBeNull();
      const kept = await prisma.agentApproval.findUniqueOrThrow({ where: { id: live } });
      expect(kept.status).toBe('PENDING');
    });

    it('cannot run or be rejected before the worker marks it', async () => {
      const id = await pendingOn('late');
      await pastExpiry(id);
      expect((await approve(id)).status).toBe(409);
      const rejected = await authPost(`/api/agent-approvals/${id}/reject`, owner.token);
      expect(rejected.status).toBe(409);
      expect(runs).toEqual([]);
    });

    it('reads as EXPIRED before the worker marks it', async () => {
      const id = await pendingOn('stale');
      await pastExpiry(id);
      const res = await authGet(`/api/agent-approvals/${id}`, owner.token);
      expect(res.body.status).toBe('EXPIRED');
    });

    it('clears input and result 30 days after the decision and keeps the row', async () => {
      const oldId = await pendingOn('old');
      const newId = await pendingOn('new');
      await approve(oldId);
      await approve(newId);
      await prisma.agentApproval.update({
        where: { id: oldId },
        data: { decidedAt: new Date(Date.now() - 31 * 24 * 3_600_000) },
      });
      await clearDecidedAgentApprovals();
      const old = await prisma.agentApproval.findUniqueOrThrow({ where: { id: oldId } });
      expect(old).toMatchObject({ input: {}, result: null, status: 'EXECUTED' });
      const recent = await prisma.agentApproval.findUniqueOrThrow({ where: { id: newId } });
      expect(recent.input).toEqual({ value: 'new' });
      expect(recent.result).toEqual({ id: 'done' });
    });
  });

  describe('a batch', () => {
    it('stops at the pending item: earlier done, this one pending, later skipped', async () => {
      const res = await act(ownerToken, {
        batch: [
          { action: 'approvalTest.free', input: { value: 'first' } },
          { action: 'approvalTest.gated', input: { value: 'second' } },
          { action: 'approvalTest.free', input: { value: 'third' } },
        ],
      });
      expect(res.status).toBe(200);
      expect(res.body.completed).toBe(1);
      expect(res.body.results[0]).toMatchObject({ ok: true });
      expect(res.body.results[1]).toMatchObject({
        ok: false,
        pending: true,
        status: 'pending_approval',
        approvalId: expect.any(String),
      });
      expect(res.body.results[2]).toEqual({ ok: false, skipped: true });
      expect(runs).toEqual(['first']);
      expect(
        await prisma.agentApproval.findUnique({ where: { id: res.body.results[1].approvalId } }),
      ).not.toBeNull();
    });
  });

  describe('reading', () => {
    it('wait answers the result once approved', async () => {
      const id = await pendingOn('waited');
      const waiting = request(app)
        .get(`/api/agent-approvals/${id}/wait`)
        .set('Authorization', ownerToken)
        .then((res) => res);
      await new Promise((resolve) => setTimeout(resolve, 300));
      await approve(id);
      const res = await waiting;
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('EXECUTED');
      expect(res.body.result).toEqual({ id: 'done' });
    });

    it('wait answers the current status when its time is up', async () => {
      const id = await pendingOn('slow');
      const res = await request(app)
        .get(`/api/agent-approvals/${id}/wait?seconds=0`)
        .set('Authorization', ownerToken);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('PENDING');
    });

    it('holds at most 2 waits per user at once', async () => {
      const id = await pendingOn('crowded');
      const wait = () =>
        request(app)
          .get(`/api/agent-approvals/${id}/wait?seconds=1`)
          .set('Authorization', ownerToken)
          .then((res) => res);
      const first = [wait(), wait()];
      await new Promise((resolve) => setTimeout(resolve, 300));
      const third = await wait();
      expect(third.status).toBe(429);
      expect((await Promise.all(first)).map((res) => res.status)).toEqual([200, 200]);
      expect((await wait()).status).toBe(200);
    });

    it('wait and get need approvals:read', async () => {
      const id = await pendingOn('scoped');
      const narrow = await tokenHeaderFor(owner, ['issues:write'], 'narrow');
      const res = await request(app).get(`/api/agent-approvals/${id}`).set('Authorization', narrow);
      expect(res.status).toBe(403);
    });

    it('shows a token only what it asked, and a session all of the user', async () => {
      const id = await pendingOn('mine');
      const second = await tokenHeaderFor(owner, undefined, 'second-agent');
      const res = await request(app).get(`/api/agent-approvals/${id}`).set('Authorization', second);
      expect(res.status).toBe(404);
      const listed = await request(app).get('/api/agent-approvals').set('Authorization', second);
      expect(listed.body.data).toEqual([]);
      const session = await authGet(`/api/agent-approvals/${id}`, owner.token);
      expect(session.status).toBe(200);
      expect(session.body).toMatchObject({ id, status: 'PENDING', input: { value: 'mine' } });
    });

    it('lists only the own rows, filtered by status', async () => {
      const own = await pendingOn('listed');
      const done = await pendingOn('finished');
      await approve(done);
      await pendingOn('foreign', memberToken);
      const all = await authGet('/api/agent-approvals', owner.token);
      expect(all.body.total).toBe(2);
      const waiting = await authGet('/api/agent-approvals?status=PENDING', owner.token);
      expect(waiting.body.data.map((row: { id: string }) => row.id)).toEqual([own]);
      expect(waiting.body.data[0].input).toBeUndefined();
    });

    it('answers 404 for the row of another user', async () => {
      const id = await pendingOn('private');
      const res = await authGet(`/api/agent-approvals/${id}`, member.token);
      expect(res.status).toBe(404);
    });
  });

  describe('telling the user', () => {
    let httpServer: Server;
    let wss: WebSocketServer;

    beforeAll(async () => {
      httpServer = createServer();
      wss = createWebSocketServer(httpServer);
      await new Promise<void>((resolve) => httpServer.listen(0, () => resolve()));
    });

    afterAll(async () => {
      wss.close();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    });

    it('notifies, whatever the preferences say', async () => {
      await prisma.notificationPreference.upsert({
        where: { userId_eventType: { userId: owner.id, eventType: 'agent:approval' } },
        update: { inApp: false, email: false },
        create: { userId: owner.id, eventType: 'agent:approval', inApp: false, email: false },
      });
      const id = await pendingOn('noticed');
      const note = await prisma.notification.findFirstOrThrow({
        where: { userId: owner.id, type: 'agent:approval', link: `/approvals/agent/${id}` },
      });
      expect(note.title).toBe('Claude Code wants to: Run the test action on noticed');
    });

    it("sends a realtime event to the user's room", async () => {
      const { port } = httpServer.address() as AddressInfo;
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${tokenFor(owner.id)}`);
      const messages: Array<Record<string, unknown>> = [];
      ws.on('message', (data: Buffer) => messages.push(JSON.parse(data.toString())));
      await new Promise<void>((resolve, reject) => {
        ws.once('open', () => resolve());
        ws.once('error', reject);
      });
      try {
        const id = await pendingOn('live');
        await waitFor(() =>
          messages.some((m) => m.type === 'agent:approval' && m.approvalId === id),
        );
      } finally {
        ws.close();
      }
    });
  });

  describe('over MCP', () => {
    it('answers pending as text, not as an error, with a URL to open', async () => {
      const issue = await createIssue();
      const served = await serveApp();
      const client = await connectMcp(served.base, ownerToken);
      try {
        const answer = await callTool(client, 'act', {
          action: 'issue.delete',
          key: `${ctx.projectPrefix}-${issue.number}`,
        });
        expect(answer.isError).toBe(false);
        expect(answer.data.status).toBe('pending_approval');
        expect(answer.data.approveUrl).toMatch(
          new RegExp(`^https?://.+/approvals/agent/${answer.data.approvalId}$`),
        );
        expect(await prisma.issue.findUnique({ where: { id: issue.id } })).not.toBeNull();
        const row = await prisma.agentApproval.findUniqueOrThrow({
          where: { id: answer.data.approvalId },
        });
        expect(row.channel).toBe('mcp');
      } finally {
        await client.close();
        await served.close();
      }
    });

    it('does not call a batch that stops at approval an error', async () => {
      const served = await serveApp();
      const client = await connectMcp(served.base, ownerToken);
      try {
        const answer = await callTool(client, 'act', {
          batch: [
            { action: 'approvalTest.free', input: { value: 'first' } },
            { action: 'approvalTest.gated', input: { value: 'second' } },
          ],
        });
        expect(answer.isError).toBe(false);
        expect(answer.data.results[1].approveUrl).toMatch(/^https?:\/\/.+\/approvals\/agent\//);
      } finally {
        await client.close();
        await served.close();
      }
    });

    it('lets a token wait through act', async () => {
      const id = await pendingOn('agent-waits');
      await approve(id);
      const served = await serveApp();
      const client = await connectMcp(served.base, ownerToken);
      try {
        const answer = await callTool(client, 'act', {
          action: 'agentApproval.wait',
          input: { id },
        });
        expect(answer.data).toMatchObject({ status: 'EXECUTED', result: { id: 'done' } });
      } finally {
        await client.close();
        await served.close();
      }
    });

    /**
     * A client connected directly to the server of one caller, declaring elicitation.
     * @param onElicit - What it does with a request
     */
    async function elicitingClient(onElicit: (message: string) => Promise<unknown>) {
      const token = await prisma.apiToken.findFirstOrThrow({
        where: { userId: owner.id, name: 'owner-agent' },
      });
      const server = createAgentServer({
        ctx: {
          userId: owner.id,
          apiTokenId: token.id,
          apiTokenName: token.name,
          scopes: token.scopes,
          channel: 'mcp',
          byName: {},
        },
        origin: 'https://axiom.example',
      });
      const client = new Client(
        { name: 'eliciting', version: '0.0.0' },
        { capabilities: { elicitation: { form: {} } } },
      );
      client.setRequestHandler(ElicitRequestSchema, async ({ params }) => {
        return (await onElicit(params.message)) as { action: 'accept' };
      });
      const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
      await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
      return { client, server };
    }

    it('points an eliciting client to the page, and its answer approves nothing', async () => {
      const seen: string[] = [];
      const { client, server } = await elicitingClient((message) => {
        seen.push(message);
        return Promise.resolve({ action: 'accept', content: {} });
      });
      try {
        const answer = await callTool(client, 'act', {
          action: 'approvalTest.gated',
          input: { value: 'pointed' },
        });
        expect(answer.isError).toBe(false);
        const url = `https://axiom.example/approvals/agent/${answer.data.approvalId}`;
        await waitFor(() => seen.length === 1);
        expect(seen[0]).toContain(url);
        await new Promise((resolve) => setTimeout(resolve, 100));
        const row = await prisma.agentApproval.findUniqueOrThrow({
          where: { id: answer.data.approvalId },
        });
        expect(row.status).toBe('PENDING');
        expect(runs).toEqual([]);
      } finally {
        await client.close();
        await server.close();
      }
    });

    it('never waits on the elicitation, and its failure changes nothing', async () => {
      const hanging = await elicitingClient(() => new Promise(() => undefined));
      const failing = await elicitingClient(() => Promise.reject(new Error('client broke')));
      try {
        for (const { client } of [hanging, failing]) {
          const answer = await callTool(client, 'act', {
            action: 'approvalTest.gated',
            input: { value: 'not held' },
          });
          expect(answer.isError).toBe(false);
          expect(answer.data.status).toBe('pending_approval');
        }
      } finally {
        await hanging.client.close();
        await hanging.server.close();
        await failing.client.close();
        await failing.server.close();
      }
    });
  });
});
