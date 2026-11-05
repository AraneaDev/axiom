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
import { LEGACY_ROUTES } from '../../actions/legacy-routes';
import { registerActions } from '../../actions/registry';
import { prisma } from '../../config/database';
import app from '../../index';
import { createAgentServer } from '../../mcp/agent-server';
import { legacyRouteDeletes, normalizeApiPath } from '../../middleware/token-scopes';
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

import {
  clearDecidedAgentApprovals,
  expireAgentApprovals,
  failStuckAgentApprovals,
} from './agent-approvals.cleanup';

const runs: string[] = [];
/** What approvalTest.slow waits for. */
let releaseSlow: () => void = () => undefined;

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
    name: 'approvalTest.unstorable',
    destructive: true,
    area: 'issues',
    kind: 'write',
    summary: 'A gated test action whose result is no JSON',
    input: z.object({}),
    output: z.looseObject({ id: z.string() }),
    authorize: () => Promise.resolve(),
    handler: () => {
      runs.push('unstorable');
      return Promise.resolve({ id: 'x', big: 1n });
    },
  }),
  defineAction({
    name: 'approvalTest.badRedact',
    destructive: true,
    area: 'issues',
    kind: 'write',
    summary: 'A gated test action whose redaction throws',
    input: z.object({}),
    output: z.looseObject({ id: z.string() }),
    redactResult: () => {
      throw new Error('redaction broke');
    },
    authorize: () => Promise.resolve(),
    handler: () => {
      runs.push('badRedact');
      return Promise.resolve({ id: 'x' });
    },
  }),
  defineAction({
    name: 'approvalTest.slow',
    destructive: true,
    area: 'issues',
    kind: 'write',
    summary: 'A gated test action that ends when told',
    input: z.object({}),
    output: z.looseObject({ id: z.string() }),
    authorize: () => Promise.resolve(),
    handler: async () => {
      runs.push('slow');
      await new Promise<void>((resolve) => {
        releaseSlow = resolve;
      });
      return { id: 'late' };
    },
  }),
  defineAction({
    name: 'approvalTest.keys',
    destructive: true,
    area: 'issues',
    kind: 'write',
    summary: 'A gated test action with several fields',
    input: z.object({ zebra: z.string(), alpha: z.looseObject({}) }),
    output: z.looseObject({ id: z.string() }),
    authorize: () => Promise.resolve(),
    handler: () => Promise.resolve({ id: 'x' }),
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

    it('falls back to the summary and the input for a preview', async () => {
      const res = await act(ownerToken, { action: 'approvalTest.plain', input: { value: 'v' } });
      expect(res.body.preview).toBe('A gated test action without a preview: {"value":"v"}');
    });

    it('sorts the keys of the fallback, whatever order the agent sent', async () => {
      const res = await act(ownerToken, {
        action: 'approvalTest.keys',
        input: { zebra: 'z', alpha: { b: 1, a: 2 } },
      });
      expect(res.body.preview).toBe(
        'A gated test action with several fields: {"alpha":{"a":2,"b":1},"zebra":"z"}',
      );
    });

    it('caps the preview, however long the input', async () => {
      const res = await act(ownerToken, {
        action: 'approvalTest.plain',
        input: { value: 'v'.repeat(5000) },
      });
      expect(res.status).toBe(202);
      expect(res.body.preview.length).toBeLessThanOrEqual(2000);
      expect(res.body.preview).toContain('[cut: the full input is on the request]');
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
      expect(audit.details).toMatchObject({
        channel: 'rest-token',
        outcome: 'ok',
        approvalId: pending.body.approvalId,
      });
    });

    it('writes a pending row in the audit log, not a done one', async () => {
      const id = await pendingOn('audited');
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { userId: owner.id, action: 'approvalTest.gated' },
        orderBy: { createdAt: 'desc' },
      });
      expect(audit.details).toMatchObject({ outcome: 'pending_approval', approvalId: id });
    });

    it('audits a pending request alike over REST, act and MCP', async () => {
      const seen: unknown[] = [];
      const pendingRow = async (id: string, action: string) => {
        const row = await prisma.auditLog.findFirstOrThrow({
          where: { userId: owner.id, action, details: { path: ['approvalId'], equals: id } },
        });
        expect(row.details).toMatchObject({ outcome: 'pending_approval', approvalId: id });
        expect(row.via).toBe('owner-agent');
        seen.push((row.details as { channel: string }).channel);
      };

      const before = new Date();
      const issue = await createIssue();
      const viaRest = await deleteIssue(issue.number, ownerToken);
      await pendingRow(viaRest.body.approvalId, 'issue.delete');
      await new Promise((resolve) => setTimeout(resolve, 100));
      // The row of the request says what it is: no generic row claims that a delete happened
      const generic = await prisma.auditLog.count({
        where: { userId: owner.id, action: 'delete', createdAt: { gte: before } },
      });
      expect(generic).toBe(0);

      const viaAct = await act(ownerToken, { action: 'approvalTest.gated', input: { value: 'a' } });
      await pendingRow(viaAct.body.approvalId, 'approvalTest.gated');

      const served = await serveApp();
      const client = await connectMcp(served.base, ownerToken);
      try {
        const answer = await callTool(client, 'act', {
          action: 'approvalTest.gated',
          input: { value: 'm' },
        });
        await pendingRow(answer.data.approvalId, 'approvalTest.gated');
      } finally {
        await client.close();
        await served.close();
      }
      expect(seen).toEqual(['rest-token', 'rest-token', 'mcp']);
    });

    it('runs once when approve and reject race, and the row says which won', async () => {
      for (let round = 0; round < 5; round++) {
        runs.length = 0;
        const id = await pendingOn(`race-${round}`);
        const [approved, rejected] = await Promise.all([
          approve(id),
          authPost(`/api/agent-approvals/${id}/reject`, owner.token),
        ]);
        expect([approved.status, rejected.status].sort()).toEqual([200, 409]);
        const row = await prisma.agentApproval.findUniqueOrThrow({ where: { id } });
        expect(row.status).toBe(approved.status === 200 ? 'EXECUTED' : 'REJECTED');
        expect(runs).toEqual(approved.status === 200 ? [`race-${round}`] : []);
      }
    });

    it.each([
      ['a result that is no JSON', 'approvalTest.unstorable', 'unstorable'],
      ['a redaction that throws', 'approvalTest.badRedact', 'badRedact'],
    ])('ends in FAILED OUTCOME_UNKNOWN after %s, and never runs again', async (_, action, ran) => {
      const pending = await act(ownerToken, { action, input: {} });
      const res = await approve(pending.body.approvalId);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('FAILED');
      expect(res.body.error.code).toBe('OUTCOME_UNKNOWN');
      expect(res.body.error.message).toContain('may have run');
      expect(runs).toEqual([ran]);
      expect((await approve(pending.body.approvalId)).status).toBe(409);
      expect(runs).toEqual([ran]);
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

    it('sweeps a row stuck in APPROVED to FAILED OUTCOME_UNKNOWN, without running it', async () => {
      const stuck = await pendingOn('stuck');
      const recent = await pendingOn('recent');
      const old = new Date(Date.now() - 2 * 3_600_000);
      await prisma.agentApproval.update({
        where: { id: stuck },
        data: { status: 'APPROVED', decidedAt: old },
      });
      await prisma.agentApproval.update({
        where: { id: recent },
        data: { status: 'APPROVED', decidedAt: new Date() },
      });
      await failStuckAgentApprovals();
      const swept = await prisma.agentApproval.findUniqueOrThrow({ where: { id: stuck } });
      expect(swept.status).toBe('FAILED');
      expect(swept.error).toMatchObject({ code: 'OUTCOME_UNKNOWN' });
      const kept = await prisma.agentApproval.findUniqueOrThrow({ where: { id: recent } });
      expect(kept.status).toBe('APPROVED');
      expect(runs).toEqual([]);
    });

    it('lets a run that ends after the sweep tell the truer outcome', async () => {
      const pending = await act(ownerToken, { action: 'approvalTest.slow', input: {} });
      const id = pending.body.approvalId as string;
      const approving = approve(id).then((res) => res);
      await waitFor(() => runs.includes('slow'));
      await prisma.agentApproval.update({
        where: { id },
        data: { decidedAt: new Date(Date.now() - 2 * 3_600_000) },
      });
      await failStuckAgentApprovals();
      releaseSlow();
      expect((await approving).body.status).toBe('EXECUTED');
      const row = await prisma.agentApproval.findUniqueOrThrow({ where: { id } });
      expect(row.status).toBe('EXECUTED');
      expect(row.result).toEqual({ id: 'late' });
      expect(runs).toEqual(['slow']);
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

  describe('legacy routes that delete', () => {
    const concrete = (path: string) => path.replace(/:[^/]+/g, 'probe');
    const deleting = LEGACY_ROUTES.filter((route) =>
      legacyRouteDeletes(route.method, normalizeApiPath(concrete(route.path))),
    );

    it('are all the DELETE routes, the star and the reaction', () => {
      const writes = deleting.filter((route) => route.method !== 'DELETE');
      expect(writes.map((route) => `${route.method} ${route.path}`).sort()).toEqual([
        'POST /api/wiki/comments/:commentId/reactions',
        'POST /api/wiki/pages/:pageId/star',
      ]);
      const deletes = LEGACY_ROUTES.filter((route) => route.method === 'DELETE');
      expect(deleting.filter((route) => route.method === 'DELETE')).toEqual(deletes);
      expect(deletes.length).toBeGreaterThan(20);
    });

    it.each(LEGACY_ROUTES.filter((route) => route.method === 'DELETE').map((r) => r.path))(
      'refuses a token on DELETE %s',
      async (path) => {
        const res = await request(app)
          .delete(concrete(path))
          .set('Authorization', ownerToken)
          .set('X-Requested-With', 'XMLHttpRequest');
        expect(res.status).toBe(403);
        expect(['NEEDS_REGISTRY_ACTION', 'SCOPE']).toContain(res.body.error.code);
      },
    );

    it.each(['/api/wiki/comments/probe/reactions', '/api/wiki/pages/probe/star'])(
      'refuses a token on POST %s, also spelled otherwise',
      async (path) => {
        for (const spelled of [path, `${path}/`, path.toUpperCase().replace('/API/', '/api/')]) {
          const res = await request(app)
            .post(spelled)
            .set('Authorization', ownerToken)
            .set('X-Requested-With', 'XMLHttpRequest')
            .send({ emoji: 'thumbsup' });
          expect(res.status).toBe(403);
          expect(res.body.error.code).toBe('NEEDS_REGISTRY_ACTION');
        }
      },
    );

    it('says what is needed, and deletes nothing', async () => {
      const label = await prisma.label.create({
        data: { projectId: ctx.projectId, name: `legacy-${Date.now()}`, color: '#000000' },
      });
      const path = `/api/projects/${ctx.projectId}/labels/${label.name}`;
      const res = await request(app)
        .delete(path)
        .set('Authorization', ownerToken)
        .set('X-Requested-With', 'XMLHttpRequest');
      expect(res.status).toBe(403);
      expect(res.body.error.message).toContain('registry action');
      expect(await prisma.label.findUnique({ where: { id: label.id } })).not.toBeNull();
      expect(await prisma.agentApproval.count({ where: { userId: owner.id } })).toBe(0);
    });

    it('still lets a browser session delete there', async () => {
      const label = await prisma.label.create({
        data: { projectId: ctx.projectId, name: `session-${Date.now()}`, color: '#000000' },
      });
      const res = await request(app)
        .delete(`/api/projects/${ctx.projectId}/labels/${label.name}`)
        .set('Authorization', `Bearer ${owner.token}`)
        .set('X-Requested-With', 'XMLHttpRequest');
      expect(res.status).toBeLessThan(300);
      expect(await prisma.label.findUnique({ where: { id: label.id } })).toBeNull();
    });

    it('leaves a read of the same area open', async () => {
      const res = await request(app)
        .get(`/api/projects/${ctx.projectId}/labels`)
        .set('Authorization', ownerToken);
      expect(res.status).toBe(200);
    });
  });

  describe('previews', () => {
    /**
     * Run a gated action through act and read its preview.
     * @param action - The action
     * @param input - Its input
     */
    async function previewOf(action: string, input: object): Promise<string> {
      const res = await act(ownerToken, { action, input });
      expect(res.status, JSON.stringify(res.body)).toBe(202);
      return res.body.preview as string;
    }

    /**
     * A space with a page, for the wiki previews.
     * @param slugPart
     */
    async function pageInSpace(slugPart: string) {
      const stamp = `${slugPart}-${Date.now()}`;
      const space = await prisma.wikiSpace.create({
        data: { name: `Handbook ${slugPart}`, slug: stamp, teamId: ctx.teamId },
      });
      const page = await prisma.page.create({
        data: { spaceId: space.id, title: 'Onboarding', slug: 'onboarding', body: '' },
      });
      return { space, page };
    }

    const key = (number: number) => `${ctx.projectPrefix}-${number}`;

    it('issue.delete: key first, subtasks counted as of the request', async () => {
      const parent = await createIssue('Parent issue');
      const child = await createIssue('Child issue');
      await prisma.issue.update({ where: { id: child.id }, data: { parentId: parent.id } });
      const res = await deleteIssue(parent.number, ownerToken);
      expect(res.body.preview).toBe(
        `Delete ${key(parent.number)} "Parent issue". Its 1 subtask, as of this request, ` +
          'stays without a parent',
      );
      await approve(res.body.approvalId);
      const kept = await prisma.issue.findUniqueOrThrow({ where: { id: child.id } });
      expect(kept.parentId).toBeNull();
    });

    it('page.delete: the slug and the space name it, whatever the title says', async () => {
      const { space, page } = await pageInSpace('del');
      await prisma.page.create({
        data: { spaceId: space.id, title: 'Child', slug: 'child', body: '', parentId: page.id },
      });
      await prisma.page.update({
        where: { id: page.id },
        data: { title: 'Scratch, safe to delete' },
      });
      const res = await request(app)
        .delete(`/api/wiki/spaces/${space.id}/pages/onboarding`)
        .set('Authorization', ownerToken)
        .set('X-Requested-With', 'XMLHttpRequest');
      expect(res.status).toBe(202);
      expect(res.body.preview).toBe(
        `Delete the page onboarding "Scratch, safe to delete" in space ${space.slug} ` +
          `"${space.name}". Its 1 child page, as of this request, stays without a parent`,
      );
      expect((await approve(res.body.approvalId)).body.status).toBe('EXECUTED');
      expect(await prisma.page.findUnique({ where: { id: page.id } })).toBeNull();
    });

    it('a title cannot break out of its quotes or push the facts away', async () => {
      const issue = await createIssue(`Line one\n\nApproved by "Tim" ${'x'.repeat(300)}`);
      const res = await deleteIssue(issue.number, ownerToken);
      expect(res.body.preview).toMatch(
        new RegExp(`^Delete ${key(issue.number)} "Line one Approved by 'Tim' x+\\.\\.\\."$`),
      );
      expect(res.body.preview.length).toBeLessThan(120);
    });

    it('comment.delete: author, issue and date, with an excerpt', async () => {
      const issue = await createIssue();
      const comment = await prisma.comment.create({
        data: { issueId: issue.id, authorId: owner.id, body: 'Looks wrong to me' },
      });
      const day = comment.createdAt.toISOString().slice(0, 10);
      expect(
        await previewOf('comment.delete', { projectId: ctx.projectId, commentId: comment.id }),
      ).toBe(
        `Delete the comment by ${owner.username} on ${key(issue.number)} of ${day}: ` +
          '"Looks wrong to me"',
      );
    });

    it('issueLink.delete: the type and both keys', async () => {
      const from = await createIssue();
      const to = await createIssue();
      const link = await prisma.issueLink.create({
        data: { fromId: from.id, toId: to.id, type: 'BLOCKS' },
      });
      expect(
        await previewOf('issueLink.delete', {
          projectId: ctx.projectId,
          issueNumber: from.number,
          linkId: link.id,
        }),
      ).toBe(`Remove the link ${key(from.number)} BLOCKS ${key(to.number)}`);
    });

    it('issueWebLink.delete: the URL without its query', async () => {
      const issue = await createIssue();
      const link = await prisma.issueWebLink.create({
        data: {
          issueId: issue.id,
          url: 'https://docs.example/guide?token=hidden',
          title: 'Guide',
          createdById: owner.id,
        },
      });
      expect(
        await previewOf('issueWebLink.delete', {
          projectId: ctx.projectId,
          issueNumber: issue.number,
          linkId: link.id,
        }),
      ).toBe(`Remove the link to https://docs.example/guide "Guide" from ${key(issue.number)}`);
    });

    it('attachment.delete: file, size, uploader and parent', async () => {
      const issue = await createIssue();
      const file = await prisma.attachment.create({
        data: {
          filename: 'stored.png',
          originalName: 'diagram.png',
          mimeType: 'image/png',
          size: 2048,
          storageKey: `approvals/${Date.now()}`,
          uploaderId: owner.id,
          issueId: issue.id,
        },
      });
      expect(await previewOf('attachment.delete', { id: file.id })).toBe(
        `Delete the file "diagram.png" (image/png, 2 KB) uploaded by ${owner.username} ` +
          `on ${key(issue.number)}`,
      );
    });

    it('savedQuery.delete: owner, sharing and date', async () => {
      const filter = await prisma.savedFilter.create({
        data: { userId: owner.id, name: 'My bugs', query: { text: 'type = Bug' } },
      });
      const day = filter.createdAt.toISOString().slice(0, 10);
      expect(await previewOf('savedQuery.delete', { filterId: filter.id })).toBe(
        `Delete the saved query "My bugs" by ${owner.username}, shared PRIVATE, made ${day}`,
      );
    });

    it('dashboard.delete and dashboardWidget.remove: owner, counts and widget', async () => {
      const dashboard = await prisma.dashboard.create({
        data: { name: 'Team health', ownerId: owner.id },
      });
      const widget = await prisma.dashboardWidget.create({
        data: { dashboardId: dashboard.id, type: 'COUNT', title: 'Open bugs', position: 0 },
      });
      const day = dashboard.createdAt.toISOString().slice(0, 10);
      expect(await previewOf('dashboard.delete', { id: dashboard.id })).toBe(
        `Delete the dashboard "Team health" by ${owner.username}, shared PRIVATE, made ${day}, ` +
          'with its 1 widget as of this request',
      );
      expect(
        await previewOf('dashboardWidget.remove', { id: dashboard.id, widgetId: widget.id }),
      ).toBe(
        `Remove the COUNT widget "Open bugs" from the dashboard "Team health" by ${owner.username}`,
      );
    });

    it('creates no doomed request for a widget or link that does not exist', async () => {
      const dashboard = await prisma.dashboard.create({
        data: { name: 'Empty', ownerId: owner.id },
      });
      const widget = await act(ownerToken, {
        action: 'dashboardWidget.remove',
        input: { id: dashboard.id, widgetId: 'missing' },
      });
      expect(widget.status).toBe(404);
      const { page } = await pageInSpace('nolink');
      const link = await act(ownerToken, {
        action: 'pageIssueLink.remove',
        input: { pageId: page.id, issueId: 'missing' },
      });
      expect(link.status).toBe(404);
      expect(await prisma.agentApproval.count({ where: { userId: owner.id } })).toBe(0);
    });

    it('pageIssueLink.remove: the page by slug and the issue by key', async () => {
      const issue = await createIssue();
      const { space, page } = await pageInSpace('link');
      await prisma.wikiPageIssueLink.create({
        data: { pageId: page.id, issueId: issue.id, linkType: 'EMBED', createdById: owner.id },
      });
      expect(await previewOf('pageIssueLink.remove', { pageId: page.id, issueId: issue.id })).toBe(
        `Remove the link between the page onboarding in space ${space.slug} and ${key(issue.number)}`,
      );
    });

    /** Eleven issues, one more than the bulk threshold. */
    async function manyIssues() {
      const issues = [];
      for (let i = 0; i < 11; i++) issues.push(await createIssue(`Bulk ${i}`));
      return issues;
    }

    it('issue.bulkUpdate: the count, some keys and each change by name', async () => {
      const issues = await manyIssues();
      const preview = await previewOf('issue.bulkUpdate', {
        projectId: ctx.projectId,
        issueIds: [...issues.map((issue) => issue.id), 'not-in-this-project'],
        updates: { priority: 'HIGH', assigneeId: member.id, labels: ['urgent'] },
      });
      expect(preview).toContain(`Change 11 issues of ${ctx.projectPrefix}`);
      expect(preview).toContain(key(issues[0].number));
      expect(preview).toContain('and 1 more');
      expect(preview).toContain(`assignee to ${member.username}`);
      expect(preview).toContain('priority to HIGH');
      expect(preview).toContain('labels to urgent');
      expect(preview).toContain('1 id outside this project is ignored');
      expect(preview).not.toContain(member.id);
    });

    it('sprint.addIssues: the sprint by name and state, some keys', async () => {
      const issues = await manyIssues();
      const sprint = await prisma.sprint.create({
        data: {
          projectId: ctx.projectId,
          name: 'Sprint 7',
          startDate: new Date('2026-11-02'),
          endDate: new Date('2026-11-16'),
        },
      });
      const preview = await previewOf('sprint.addIssues', {
        projectId: ctx.projectId,
        sprintId: sprint.id,
        issueIds: issues.map((issue) => issue.id),
      });
      expect(preview).toContain(
        `Add 11 issues of ${ctx.projectPrefix} to the sprint "Sprint 7" ` +
          '(PLANNING, 2026-11-02 to 2026-11-16)',
      );
      expect(preview).toContain(key(issues[0].number));
    });

    it('issue.move: the issue by key, and no name from another project', async () => {
      const issue = await createIssue();
      const elsewhere = await createTestContext('agent-approvals-other');
      try {
        const column = await prisma.boardColumn.create({
          data: { projectId: elsewhere.projectId, name: 'Secret column', position: 50 },
        });
        const preview = await previewOf('issue.move', {
          projectId: ctx.projectId,
          issueNumber: issue.number,
          columnId: column.id,
        });
        expect(preview).toBe(
          `Move ${key(issue.number)} "Target issue" to a column of another project`,
        );
      } finally {
        await cleanupTestContext(elsewhere);
      }
    });

    it('page.move: from where to where by slug', async () => {
      const from = await pageInSpace('from');
      const to = await pageInSpace('to');
      const preview = await previewOf('page.move', {
        pageId: from.page.id,
        targetSpaceId: to.space.id,
      });
      expect(preview).toBe(
        `Move the page onboarding "Onboarding" from space ${from.space.slug} ` +
          `to space ${to.space.slug} "${to.space.name}"`,
      );
    });

    it('page.move: refuses a destination the caller may not write before asking', async () => {
      const from = await pageInSpace('reach');
      const stranger = await createTestContext('agent-approvals-stranger');
      try {
        const space = await prisma.wikiSpace.create({
          data: { name: 'Their space', slug: `their-${Date.now()}`, teamId: stranger.teamId },
        });
        const res = await act(ownerToken, {
          action: 'page.move',
          input: { pageId: from.page.id, targetSpaceId: space.id },
        });
        expect([403, 404]).toContain(res.status);
        expect(JSON.stringify(res.body)).not.toContain('Their space');
        expect(await prisma.agentApproval.count({ where: { userId: owner.id } })).toBe(0);
      } finally {
        await cleanupTestContext(stranger);
      }
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
      expect(note.title).toBe('owner-agent wants to: Run the test action on noticed');
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
