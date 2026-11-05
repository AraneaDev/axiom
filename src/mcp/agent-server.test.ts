/**
 * The MCP server over real HTTP: the five tools, the same paths and refusals as REST, batches, and
 * the security cases of the SSE server it replaced.
 */
import { execFile } from 'child_process';
import { randomBytes } from 'crypto';
import { rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { promisify } from 'util';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { ACT_LIMIT, MAX_BATCH_ITEMS } from '../actions/batch';
import { defineAction } from '../actions/define';
import { executeAction } from '../actions/execute';
import { registerActions } from '../actions/registry';
import { prisma } from '../config/database';
import { cacheGet, cacheInvalidate } from '../config/redis';
import app from '../index';
import { issueFieldRegistry } from '../lib/query-engine';
import { AppError } from '../middleware/errorHandler';
import { SEARCH_LIMIT } from '../middleware/rate-limit';
import { MINTABLE_SCOPES } from '../middleware/token-scopes';
import {
  getSiteSettings,
  updateSiteSettings,
} from '../modules/site-settings/site-settings.service';
import {
  addMemberToContext,
  cleanupTestContext,
  createTestContext,
  createTestUser,
  type TestContext,
  type TestUser,
} from '../test/factory';
import { authPost } from '../test/helpers';
import {
  callTool,
  connectMcp,
  serveApp,
  tokenHeaderFor,
  type ToolAnswer,
} from '../test/mcp-client';

const storagePath = path.join(tmpdir(), `axiom-mcp-test-${process.pid}`);
process.env.STORAGE_PATH = storagePath;

const CSRF = { 'X-Requested-With': 'XMLHttpRequest' };
const INITIALIZE = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'raw', version: '0.0.0' },
  },
};
const MCP_ACCEPT = 'application/json, text/event-stream';

describe('MCP server', () => {
  let ctx: TestContext;
  let base: string;
  let closeServer: () => Promise<void>;
  let spaceId: string;
  let ownerAuth: Record<string, string>;
  const clients: Client[] = [];
  const created: string[] = [];

  const tokenHeader = (scopes: string[], owner: TestUser = ctx.owner, name = 'mcp-agent') =>
    tokenHeaderFor(owner, scopes, name);

  async function client(authorization: string): Promise<Client> {
    const connected = await connectMcp(base, authorization);
    clients.push(connected);
    return connected;
  }

  const asUser = async (user: TestUser) => client(await tokenHeaderFor(user));

  function rawPost(body: unknown, headers: Record<string, string> = {}) {
    return fetch(`${base}/api/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: MCP_ACCEPT, ...headers },
      body: JSON.stringify(body),
    });
  }

  // issue.create takes the highest number plus one, so counting down never meets it
  let nextNumber = 1_000_000;
  async function createIssue(title = 'An issue') {
    const number = nextNumber--;
    await prisma.issue.create({
      data: { projectId: ctx.projectId, number, title, body: '', creatorId: ctx.owner.id },
    });
    return { number, key: `${ctx.projectPrefix}-${number}` };
  }

  async function createPage(slug: string, body = 'before', inSpace = spaceId) {
    return prisma.page.create({ data: { spaceId: inSpace, title: slug, slug, body } });
  }

  function expectRefused(answer: ToolAnswer, status: number, code?: string) {
    expect(answer.isError).toBe(true);
    expect(answer.data.status).toBe(status);
    if (code) expect(answer.data.code).toBe(code);
    expect(Object.keys(answer.data).sort()).toEqual(['code', 'message', 'status']);
  }

  beforeAll(async () => {
    ctx = await createTestContext(`mcpag${Date.now()}`);
    const space = await prisma.wikiSpace.create({
      data: { teamId: ctx.teamId, name: 'Agent space', slug: 'agent-space' },
    });
    spaceId = space.id;
    ({ base, close: closeServer } = await serveApp());
    ownerAuth = { Authorization: await tokenHeaderFor(ctx.owner) };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await Promise.all(clients.map((c) => c.close()));
    await closeServer();
    await cleanupTestContext(ctx);
    await prisma.user.deleteMany({ where: { id: { in: created } } });
    await rm(storagePath, { recursive: true, force: true });
  });

  async function newUser() {
    const user = await createTestUser();
    created.push(user.id);
    return user;
  }

  async function newMember() {
    const member = await addMemberToContext(ctx);
    created.push(member.id);
    return member;
  }

  describe('tools', () => {
    it('lists exactly the five tools', async () => {
      const { tools } = await (await asUser(ctx.owner)).listTools();
      expect(tools.map((t) => t.name).sort()).toEqual([
        'act',
        'describe',
        'read',
        'search',
        'upload',
      ]);
      for (const tool of tools) expect(tool.inputSchema.type).toBe('object');
    });

    it('answers an unknown tool, such as a removed one, as an unknown-tool error', async () => {
      const c = await asUser(ctx.owner);
      expectRefused(await callTool(c, 'list_repos'), 404, 'UNKNOWN_TOOL');
      expectRefused(await callTool(c, 'get_issue', { issueNumber: 1 }), 404, 'UNKNOWN_TOOL');
    });

    it('act runs issue.update with the same scope rules as REST', async () => {
      const { number } = await createIssue();
      const header = await tokenHeader(['wiki:write', 'search:read']);
      const answer = await callTool(await client(header), 'act', {
        action: 'issue.update',
        input: { projectId: ctx.projectId, issueNumber: number, title: 'Nope' },
      });
      expectRefused(answer, 403, 'SCOPE');

      const rest = await request(app)
        .patch(`/api/projects/${ctx.projectId}/issues/${number}`)
        .set('Authorization', header)
        .set(CSRF)
        .send({ title: 'Nope' });
      expect(rest.status).toBe(403);
      expect(rest.body.error.code).toBe('SCOPE');
      expect(answer.data.message).toBe(rest.body.error.message);

      const writer = await client(await tokenHeader(['issues:write']));
      const done = await callTool(writer, 'act', {
        action: 'issue.update',
        input: { projectId: ctx.projectId, issueNumber: number, title: 'Changed' },
      });
      expect(done.isError).toBe(false);
      expect(done.data.title).toBe('Changed');
    });

    it('a token with only a read scope can use the endpoint, which is always a POST', async () => {
      const c = await client(await tokenHeader(['sprints:read']));
      const sprints = await callTool(c, 'act', {
        action: 'sprint.list',
        input: { projectId: ctx.projectId },
      });
      expect(sprints.isError).toBe(false);
    });

    it('attributes writes to the name of the token, whatever the client calls itself', async () => {
      const { number } = await createIssue();
      const c = await client(await tokenHeader(['issues:write'], ctx.owner, 'ci-bot'));
      await callTool(c, 'act', {
        action: 'comment.add',
        input: { projectId: ctx.projectId, issueNumber: number, body: 'From the agent' },
      });
      const comment = await prisma.comment.findFirstOrThrow({
        where: { body: 'From the agent' },
      });
      expect(comment.authorId).toBe(ctx.owner.id);
      const activity = await prisma.activity.findFirstOrThrow({
        where: { via: 'ci-bot' },
      });
      expect(activity.apiTokenId).not.toBeNull();
    });
  });

  describe('describe', () => {
    it('hides actions the token scopes do not allow', async () => {
      const c = await client(await tokenHeader(['wiki:read']));
      const { data } = await callTool(c, 'describe');
      const names = (data as Array<{ name: string; area: string }>).map((a) => a.name);
      expect(names).toContain('page.get');
      expect(names).not.toContain('issue.update');
      expect(names).not.toContain('page.update');
      // Wiki, and the own-state actions (profile, notifications) that a wiki read opens as well
      expect(new Set((data as Array<{ area: string }>).map((a) => a.area))).toEqual(
        new Set(['wiki', 'issues']),
      );
      expect(names).not.toContain('issue.get');

      expectRefused(await callTool(c, 'describe', { action: 'issue.update' }), 403, 'SCOPE');
    });

    it('lists neither what tokens may never run nor what needs raw HTTP', async () => {
      const { data } = await callTool(await asUser(ctx.owner), 'describe');
      const names = (data as Array<{ name: string }>).map((a) => a.name);
      expect(names).toContain('issue.update');
      expect(names).toContain('search.run');
      expect(names).toContain('item.read');
      expect(names).not.toContain('attachment.upload');
      expect(names).not.toContain('attachment.download');
      expect(names).not.toContain('issue.export');
    });

    it('narrows by area, and gives a schema for every action it lists', async () => {
      const c = await asUser(ctx.owner);
      const sprints = await callTool(c, 'describe', { area: 'sprints' });
      expect((sprints.data as Array<{ area: string }>).every((a) => a.area === 'sprints')).toBe(
        true,
      );

      const { data } = await callTool(c, 'describe');
      for (const { name } of data as Array<{ name: string }>) {
        const one = await callTool(c, 'describe', { action: name });
        expect(one.isError, name).toBe(false);
        expect(one.data.input, name).toBeTypeOf('object');
        expect(one.data.output, name).toBeTypeOf('object');
      }
      const update = await callTool(c, 'describe', { action: 'issue.update' });
      expect(update.data.key).toBe('issue');
      expect(Object.keys(update.data.input.properties)).toEqual(
        expect.arrayContaining(['projectId', 'issueNumber', 'status', 'columnId']),
      );
    });

    it('answers an unknown action, and a raw one naming what to use', async () => {
      const c = await asUser(ctx.owner);
      expectRefused(await callTool(c, 'describe', { action: 'nope.nope' }), 404, 'UNKNOWN_ACTION');
      const raw = await callTool(c, 'describe', { action: 'attachment.upload' });
      expectRefused(raw, 400, 'RAW_ACTION');
      expect(raw.data.message).toContain('upload tool');
    });
  });

  describe('act', () => {
    it('refuses a raw action, naming the alternative', async () => {
      const answer = await callTool(await asUser(ctx.owner), 'act', {
        action: 'attachment.upload',
        input: {},
      });
      expectRefused(answer, 400, 'RAW_ACTION');
      expect(answer.data.message).toContain('upload tool');
    });

    it('asks for exactly one of action and batch', async () => {
      const c = await asUser(ctx.owner);
      expectRefused(await callTool(c, 'act', {}), 400);
      const both = await callTool(c, 'act', {
        action: 'org.list',
        batch: [{ action: 'org.list' }],
      });
      expectRefused(both, 400);
    });

    it('a batch stops at the first failure and marks the rest skipped', async () => {
      const { data, isError } = await callTool(await asUser(ctx.owner), 'act', {
        batch: [
          { action: 'issue.create', input: { projectId: ctx.projectId, title: 'Batch one' } },
          { action: 'issue.create', input: { projectId: ctx.projectId, title: 'Batch two' } },
          { action: 'issue.create', input: { projectId: ctx.projectId } },
          { action: 'issue.create', input: { projectId: ctx.projectId, title: 'Batch four' } },
        ],
      });
      expect(isError).toBe(true);
      expect(data.completed).toBe(2);
      expect(data.results.map((r: { ok: boolean }) => r.ok)).toEqual([true, true, false, false]);
      expect(data.results[2].error).toMatchObject({ status: 400 });
      expect(data.results[3]).toEqual({ ok: false, skipped: true });
      expect(
        await prisma.issue.count({
          where: { projectId: ctx.projectId, title: { in: ['Batch one', 'Batch two'] } },
        }),
      ).toBe(2);
      expect(
        await prisma.issue.count({ where: { projectId: ctx.projectId, title: 'Batch four' } }),
      ).toBe(0);
    });

    it('authorizes each item of a batch on its own', async () => {
      const { number } = await createIssue();
      const c = await client(await tokenHeader(['issues:read']));
      const { data } = await callTool(c, 'act', {
        batch: [
          { action: 'issue.get', input: { projectId: ctx.projectId, issueNumber: number } },
          {
            action: 'issue.update',
            input: { projectId: ctx.projectId, issueNumber: number, title: 'Sneaky' },
          },
          { action: 'issue.get', input: { projectId: ctx.projectId, issueNumber: number } },
        ],
      });
      expect(data.completed).toBe(1);
      expect(data.results[1].error).toMatchObject({ status: 403, code: 'SCOPE' });
      expect(data.results[2].skipped).toBe(true);
    });

    it('refuses a batch over the limit without running anything', async () => {
      const title = `Over the limit ${Date.now()}`;
      const batch = Array.from({ length: MAX_BATCH_ITEMS + 1 }, () => ({
        action: 'issue.create',
        input: { projectId: ctx.projectId, title },
      }));
      expectRefused(
        await callTool(await asUser(ctx.owner), 'act', { batch }),
        400,
        'BATCH_TOO_LARGE',
      );

      const rest = await authPost('/api/act', ctx.owner.token, { batch });
      expect(rest.status).toBe(400);
      expect(rest.body.error.code).toBe('BATCH_TOO_LARGE');
      expect(await prisma.issue.count({ where: { title } })).toBe(0);
    });

    it('counts batch items toward a limit per user, before running anything', async () => {
      const user = await newUser();
      const c = await asUser(user);
      const batch = Array.from({ length: MAX_BATCH_ITEMS }, () => ({ action: 'nope.nope' }));
      for (let used = 0; used + MAX_BATCH_ITEMS <= ACT_LIMIT.max; used += MAX_BATCH_ITEMS) {
        const { data, isError } = await callTool(c, 'act', { batch });
        expect(isError).toBe(true);
        expect(data.results[0].error.code).toBe('UNKNOWN_ACTION');
      }
      expectRefused(await callTool(c, 'act', { batch }), 429, 'RATE_LIMITED');
      // A single action draws from the same count
      expectRefused(await callTool(c, 'act', { action: 'org.list' }), 429, 'RATE_LIMITED');
      // Another user has a count of their own
      expect((await callTool(await asUser(ctx.owner), 'act', { action: 'org.list' })).isError).toBe(
        false,
      );
    });

    it('gives a generic answer on an unexpected error', async () => {
      const issues = await import('../modules/issues/issues.service');
      vi.spyOn(issues, 'getTimeReport').mockRejectedValue(
        new Error('Invalid `prisma.issue.findMany()` invocation: secret connection string'),
      );
      const c = await asUser(ctx.owner);
      const answer = await callTool(c, 'act', {
        action: 'issue.timeReport',
        input: { projectId: ctx.projectId },
      });
      expect(answer).toMatchObject({
        isError: true,
        data: { status: 500, code: 'INTERNAL_ERROR', message: 'Internal server error' },
      });
      expect(answer.text).not.toContain('prisma');
      expect(answer.text).not.toContain('stack');
    });
  });

  describe('act by key', () => {
    it('updates an issue in one call by key and status name, any case', async () => {
      const { number, key } = await createIssue();
      const c = await client(await tokenHeader(['issues:write']));
      const done = await callTool(c, 'act', {
        action: 'issue.update',
        key,
        input: { status: 'dOnE' },
      });
      expect(done.isError).toBe(false);
      const issue = await prisma.issue.findUniqueOrThrow({
        where: { projectId_number: { projectId: ctx.projectId, number } },
        include: { column: true },
      });
      expect(issue.column?.name.toLowerCase()).toBe('done');
    });

    it('takes a page key for a page action', async () => {
      const page = await createPage(`by-key-${Date.now()}`);
      const c = await asUser(ctx.owner);
      const key = `${ctx.orgSlug}/${ctx.teamSlug}/agent-space/${page.slug}`;
      const updated = await callTool(c, 'act', {
        action: 'page.update',
        key,
        input: { body: 'after' },
      });
      expect(updated.isError).toBe(false);
      expect((await prisma.page.findUniqueOrThrow({ where: { id: page.id } })).body).toBe('after');
    });

    it('answers 400 on a conflict between the key and the ids in the input', async () => {
      const { number, key } = await createIssue();
      const c = await asUser(ctx.owner);
      expectRefused(
        await callTool(c, 'act', {
          action: 'issue.update',
          key,
          input: { projectId: 'another-project', title: 'x' },
        }),
        400,
        'KEY_CONFLICT',
      );
      expectRefused(
        await callTool(c, 'act', {
          action: 'issue.update',
          key,
          input: { issueNumber: number + 1000, title: 'x' },
        }),
        400,
        'KEY_CONFLICT',
      );
      // The same ids are no conflict
      const same = await callTool(c, 'act', {
        action: 'issue.get',
        key,
        input: { projectId: ctx.projectId, issueNumber: number },
      });
      expect(same.isError).toBe(false);
    });

    it('answers 404 alike for an invisible and a missing issue', async () => {
      const { key } = await createIssue();
      const stranger = await newUser();
      const c = await asUser(stranger);
      const hidden = await callTool(c, 'act', { action: 'issue.get', key });
      const missing = await callTool(c, 'act', {
        action: 'issue.get',
        key: `${ctx.projectPrefix}-99999`,
      });
      expectRefused(hidden, 404, 'NOT_FOUND');
      expect(hidden.data).toEqual(missing.data);
    });

    it('answers AMBIGUOUS_KEY for a prefix two visible teams use', async () => {
      const { key, number } = await createIssue();
      const other = await prisma.team.create({
        data: {
          orgId: ctx.orgId,
          name: 'Twin',
          slug: `twin-${Date.now()}`,
          members: { create: { userId: ctx.owner.id, role: 'ADMIN' } },
        },
      });
      const twin = await prisma.project.create({
        data: { teamId: other.id, name: 'Twin', slug: 'twin', prefix: ctx.projectPrefix },
      });
      try {
        const c = await asUser(ctx.owner);
        expectRefused(await callTool(c, 'act', { action: 'issue.get', key }), 409, 'AMBIGUOUS_KEY');
        const full = await callTool(c, 'act', {
          action: 'issue.get',
          key: `${ctx.orgSlug}/${ctx.teamSlug}/${key}`,
        });
        expect(full.data.number).toBe(number);
      } finally {
        await prisma.project.delete({ where: { id: twin.id } });
        await prisma.team.delete({ where: { id: other.id } });
      }
    });

    it('does not look up a key for a token that may not run the action', async () => {
      const c = await client(await tokenHeader(['wiki:write']));
      const missing = await callTool(c, 'act', {
        action: 'issue.get',
        key: `${ctx.projectPrefix}-99999`,
      });
      expectRefused(missing, 403, 'SCOPE');
    });

    it('holds the key to the role check of the action', async () => {
      const { number, key } = await createIssue('Role check');
      const viewer = await newMember();
      await prisma.teamMembership.update({
        where: { userId_teamId: { userId: viewer.id, teamId: ctx.teamId } },
        data: { role: 'VIEWER' },
      });
      const c = await asUser(viewer);
      expectRefused(
        await callTool(c, 'act', { action: 'issue.update', key, input: { title: 'x' } }),
        403,
        'FORBIDDEN',
      );
      const issue = await prisma.issue.findUniqueOrThrow({
        where: { projectId_number: { projectId: ctx.projectId, number } },
      });
      expect(issue.title).toBe('Role check');
    });

    it('refuses a key an action cannot take, or of the other kind', async () => {
      const { key } = await createIssue();
      const c = await asUser(ctx.owner);
      expectRefused(await callTool(c, 'act', { action: 'org.list', key }), 400, 'KEY_NOT_ACCEPTED');
      expectRefused(await callTool(c, 'act', { action: 'page.get', key }), 400, 'KEY_NOT_ACCEPTED');
      expectRefused(
        await callTool(c, 'act', { action: 'issue.get', key: 'not a key' }),
        400,
        'INVALID_KEY',
      );
    });

    it('resolves a key per item of a batch, and over REST', async () => {
      const first = await createIssue('First');
      const second = await createIssue('Second');
      const res = await authPost('/api/act', ctx.owner.token, {
        batch: [
          { action: 'issue.get', key: first.key },
          { action: 'issue.get', key: second.key },
        ],
      });
      expect(res.status).toBe(200);
      expect(res.body.completed).toBe(2);
      expect(res.body.results.map((r: { result: { title: string } }) => r.result.title)).toEqual([
        'First',
        'Second',
      ]);
    });
  });

  describe('status by name', () => {
    it('answers 400 listing the valid names for an unknown one', async () => {
      const { key } = await createIssue();
      const answer = await callTool(await asUser(ctx.owner), 'act', {
        action: 'issue.update',
        key,
        input: { status: 'Shipped' },
      });
      expectRefused(answer, 400, 'INVALID_STATUS');
      const columns = await prisma.boardColumn.findMany({ where: { projectId: ctx.projectId } });
      expect(columns.length).toBeGreaterThan(0);
      for (const column of columns) expect(answer.data.message).toContain(column.name);
    });

    it('answers 400 when both status and columnId are given', async () => {
      const { key } = await createIssue();
      const column = await prisma.boardColumn.findFirstOrThrow({
        where: { projectId: ctx.projectId },
      });
      expectRefused(
        await callTool(await asUser(ctx.owner), 'act', {
          action: 'issue.update',
          key,
          input: { status: column.name, columnId: column.id },
        }),
        400,
      );
    });

    it('works over REST too', async () => {
      const { number } = await createIssue();
      const column = await prisma.boardColumn.findFirstOrThrow({
        where: { projectId: ctx.projectId },
        orderBy: { position: 'desc' },
      });
      const res = await request(app)
        .patch(`/api/projects/${ctx.projectId}/issues/${number}`)
        .set('Authorization', `Bearer ${ctx.owner.token}`)
        .set(CSRF)
        .send({ status: column.name.toUpperCase() });
      expect(res.status).toBe(200);
      expect(res.body.columnId).toBe(column.id);
    });

    it('still meets approval gates and workflow rules', async () => {
      const columns = await prisma.boardColumn.findMany({
        where: { projectId: ctx.projectId },
        orderBy: { position: 'asc' },
      });
      const [from, to] = [columns[0], columns[columns.length - 1]];
      const { number, key } = await createIssue();
      await prisma.issue.update({
        where: { projectId_number: { projectId: ctx.projectId, number } },
        data: { columnId: from.id },
      });
      const c = await asUser(ctx.owner);
      const move = () =>
        callTool(c, 'act', { action: 'issue.update', key, input: { status: to.name } });

      const gate = await prisma.approvalGate.create({
        data: { projectId: ctx.projectId, fromColumnId: from.id, toColumnId: to.id },
      });
      expectRefused(await move(), 409);
      await prisma.approvalGate.delete({ where: { id: gate.id } });

      // The source column has a rule, and it doesn't lead to this one
      const rule = await prisma.workflowRule.create({
        data: { projectId: ctx.projectId, fromColumnId: from.id, toColumnId: columns[1].id },
      });
      const refused = await move();
      await prisma.workflowRule.delete({ where: { id: rule.id } });
      expectRefused(refused, 400);
      expect(refused.data.message).toContain('workflow rules');

      expect((await move()).isError).toBe(false);
    });
  });

  describe('read and search', () => {
    it('read is item.read, with its per-item scope', async () => {
      const { key } = await createIssue('Readable');
      const page = await createPage(`readable-${Date.now()}`);
      const pageKey = `${ctx.orgSlug}/${ctx.teamSlug}/agent-space/${page.slug}`;
      const c = await client(await tokenHeader(['search:read', 'issues:read']));
      const { data } = await callTool(c, 'read', { keys: [key, pageKey] });
      expect(data.items[0].data.title).toBe('Readable');
      expect(data.items[1].error).toMatchObject({ status: 403, code: 'SCOPE' });
    });

    it('a token with the scopes the token page starts with can read and search', async () => {
      const { key } = await createIssue('Default scopes');
      const c = await client(
        await tokenHeader(['search:read', 'issues:read', 'wiki:read', 'files:read']),
      );
      const read = await callTool(c, 'read', { keys: [key], include: ['attachments'] });
      expect(read.data.items[0].error).toBeUndefined();
      expect(read.data.items[0].data.title).toBe('Default scopes');
      expect((await callTool(c, 'search', { query: 'Default scopes' })).isError).toBe(false);
    });

    it('search needs search:read and shows only the sections the token covers', async () => {
      const mark = `agentsearch${Date.now()}`;
      await createIssue(`Issue ${mark}`);
      await createPage(mark, `Page body ${mark}`);

      expectRefused(
        await callTool(await client(await tokenHeader(['issues:read'])), 'search', { query: mark }),
        403,
        'SCOPE',
      );

      const types = async (scopes: string[], args: object = {}) => {
        const c = await client(await tokenHeader(scopes));
        const { data } = await callTool(c, 'search', { query: mark, ...args });
        return (data as Array<{ type: string }>).map((section) => section.type);
      };
      expect(await types(['search:read'])).toEqual([]);
      expect(await types(['search:read', 'issues:read'])).toEqual(['issues']);
      expect(await types(['search:read', 'wiki:read'])).toEqual(['wiki']);
      expect(await types(['search:read', 'issues:read', 'wiki:read'], { type: 'wiki' })).toEqual([
        'wiki',
      ]);
    });

    it('answers small results named by a key that read takes', async () => {
      const mark = `compactsearch${Date.now()}`;
      await createIssue(`Issue ${mark}`);
      const page = await createPage(`${mark}-page`, `Body ${mark}`);
      const c = await asUser(ctx.owner);
      const { data } = await callTool(c, 'search', { query: mark });
      const [issues, wiki] = data as Array<{ items: Array<Record<string, string>> }>;
      expect(issues.items[0].fullKey).toContain(`${ctx.orgSlug}/${ctx.teamSlug}/`);
      expect(wiki.items[0].key).toBe(`${ctx.orgSlug}/${ctx.teamSlug}/agent-space/${page.slug}`);
      expect(wiki.items[0]).not.toHaveProperty('body');
      expect(issues.items[0]).not.toHaveProperty('body');

      const read = await callTool(c, 'read', {
        keys: [issues.items[0].fullKey, wiki.items[0].key],
      });
      expect(read.data.items.every((item: { data?: unknown }) => item.data)).toBe(true);
    });

    it('puts a page titled exactly the query first, even punctuation full-text drops', async () => {
      const title = `C++ & Friends ${Date.now()}`;
      const exact = await prisma.page.create({
        data: {
          spaceId,
          title,
          slug: `exact-${Date.now()}`,
          body: 'Nothing else',
          updatedAt: new Date(0),
        },
      });
      await createPage(`also-${Date.now()}`, `This names ${title} in its text`);
      const { data } = await callTool(await asUser(ctx.owner), 'search', {
        query: title.toLowerCase(),
        type: 'wiki',
        limit: 1,
      });
      expect(data[0].items).toHaveLength(1);
      expect(data[0].items[0].slug).toBe(exact.slug);
    });

    it('holds the exact title to page access', async () => {
      const title = `Hidden exact ${Date.now()}`;
      const page = await prisma.page.create({
        data: { spaceId, title, slug: `hidden-exact-${Date.now()}`, body: 'x' },
      });
      await prisma.pageRestriction.create({
        data: { pageId: page.id, type: 'VIEW', userId: ctx.owner.id },
      });
      const member = await newMember();
      const { text } = await callTool(await asUser(member), 'search', { query: title });
      expect(text).not.toContain(page.slug);
    });

    it('limits searches per user as the REST search does', async () => {
      const user = await newUser();
      const c = await asUser(user);
      for (let i = 0; i < SEARCH_LIMIT.max; i++) {
        expect((await callTool(c, 'search', { query: 'nothing' })).isError).toBe(false);
      }
      expectRefused(await callTool(c, 'search', { query: 'nothing' }), 429, 'RATE_LIMITED');
      const viaAct = await callTool(c, 'act', {
        action: 'search.run',
        input: { query: 'nothing' },
      });
      expectRefused(viaAct, 429, 'RATE_LIMITED');
    });
  });

  describe('upload', () => {
    const png = Buffer.from('89504e470d0a1a0a', 'hex');
    const file = { filename: 'shot.png', mimeType: 'image/png', size: png.length };

    it('answers a curl line that really uploads the file to the issue a key names', async () => {
      const { number, key } = await createIssue();
      const c = await client(await tokenHeader(['files:write', 'issues:write']));
      const { data, isError } = await callTool(c, 'upload', { ...file, target: key });
      expect(isError).toBe(false);
      expect(data.uploadUrl.startsWith(`${base}/api/uploads/`)).toBe(true);
      expect(data.attachmentUrl).toBeTruthy();
      expect(data.curl).toContain('@<path>');

      const local = path.join(tmpdir(), `mcp-upload-${randomBytes(6).toString('hex')}.png`);
      await writeFile(local, png);
      try {
        const line = (data.curl as string).replace('@<path>', `@${local}`);
        await promisify(execFile)('sh', ['-c', `${line} --fail --silent --show-error`]);
      } finally {
        await rm(local, { force: true });
      }
      const issue = await prisma.issue.findUniqueOrThrow({
        where: { projectId_number: { projectId: ctx.projectId, number } },
        include: { attachments: true },
      });
      expect(issue.attachments.map((a) => a.originalName)).toEqual(['shot.png']);
    });

    it('takes a page key, and an object target', async () => {
      const page = await createPage(`upload-${Date.now()}`);
      const key = `${ctx.orgSlug}/${ctx.teamSlug}/agent-space/${page.slug}`;
      const c = await asUser(ctx.owner);
      expect((await callTool(c, 'upload', { ...file, target: key })).isError).toBe(false);
      const object = await callTool(c, 'upload', { ...file, target: { pageKey: key } });
      expect(object.isError).toBe(false);
    });

    it('holds to the scopes of Task 8', async () => {
      const { key } = await createIssue();
      const noFiles = await client(await tokenHeader(['issues:write']));
      expectRefused(await callTool(noFiles, 'upload', { ...file, target: key }), 403, 'SCOPE');
      const noParent = await client(await tokenHeader(['files:write']));
      expectRefused(await callTool(noParent, 'upload', { ...file, target: key }), 403, 'SCOPE');
    });

    it('with url goes through attachment.fromUrl and its guard', async () => {
      const answer = await callTool(await asUser(ctx.owner), 'upload', {
        url: 'http://127.0.0.1/secret',
      });
      expect(answer.isError).toBe(true);
      expect(answer.data.status).toBe(400);
    });

    it('refuses a raw call without the fields of a file', async () => {
      expectRefused(await callTool(await asUser(ctx.owner), 'upload', {}), 400);
    });
  });

  describe('HTTP', () => {
    it('refuses the old SSE endpoints', async () => {
      const { token } = ctx.owner;
      const stream = await fetch(`${base}/api/mcp`, {
        headers: { ...ownerAuth, Accept: 'text/event-stream' },
      });
      expect(stream.status).toBe(405);
      expect(stream.headers.get('content-type')).not.toContain('text/event-stream');
      await stream.text();

      const messages = await authPost('/api/mcp/messages?session=abc', token, {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
      });
      expect(messages.status).toBe(404);
    });

    it('answers DELETE with 405, as there is no session to end', async () => {
      const res = await fetch(`${base}/api/mcp`, {
        method: 'DELETE',
        headers: ownerAuth,
      });
      expect(res.status).toBe(405);
    });

    it('asks for authentication first, on every method', async () => {
      expect((await rawPost(INITIALIZE)).status).toBe(401);
      expect((await fetch(`${base}/api/mcp`)).status).toBe(401);
      expect((await fetch(`${base}/api/mcp`, { method: 'DELETE' })).status).toBe(401);
    });

    it('needs no CSRF header on exactly /api/mcp', async () => {
      const auth = ownerAuth;
      expect((await rawPost(INITIALIZE, auth)).status).toBe(200);

      const other = await fetch(`${base}/api/mcp/messages`, {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: '{}',
      });
      expect(other.status).toBe(403);
      expect(((await other.json()) as { error: { code: string } }).error.code).toBe(
        'CSRF_HEADER_MISSING',
      );

      const act = await fetch(`${base}/api/act`, {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'org.list' }),
      });
      expect(act.status).toBe(403);
    });

    it('refuses a foreign Origin ahead of everything, and allows none or the site', async () => {
      const auth = ownerAuth;
      for (const origin of ['https://evil.example', 'null', 'not a url']) {
        const res = await rawPost(INITIALIZE, { ...auth, Origin: origin });
        expect(res.status, origin).toBe(403);
        expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
          'INVALID_ORIGIN',
        );
      }
      expect((await rawPost(INITIALIZE, { ...auth, Origin: 'http://localhost:7000' })).status).toBe(
        200,
      );

      vi.stubEnv('FRONTEND_URL', 'https://axiom.example/');
      try {
        expect(
          (await rawPost(INITIALIZE, { ...auth, Origin: 'https://axiom.example' })).status,
        ).toBe(200);
        expect(
          (await rawPost(INITIALIZE, { ...auth, Origin: 'http://localhost:7000' })).status,
        ).toBe(403);
        expect((await rawPost(INITIALIZE, auth)).status).toBe(200);
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it('answers a body it cannot parse or take as a client error', async () => {
      const auth = ownerAuth;
      const malformed = await fetch(`${base}/api/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: MCP_ACCEPT, ...auth },
        body: '{ not json',
      });
      expect(malformed.status).toBe(400);
      const tooLarge = await fetch(`${base}/api/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: MCP_ACCEPT, ...auth },
        body: JSON.stringify({ padding: 'x'.repeat(6 * 1024 * 1024) }),
      });
      expect(tooLarge.status).toBe(413);
    });

    it('takes one message per request, so one request is one call', async () => {
      const res = await rawPost(
        [INITIALIZE, { jsonrpc: '2.0', id: 2, method: 'tools/list' }],
        ownerAuth,
      );
      expect(res.status).toBe(400);
    });

    it('closes the server and transport of every request', async () => {
      const close = vi.spyOn(StreamableHTTPServerTransport.prototype, 'close');
      const res = await rawPost(INITIALIZE, ownerAuth);
      expect(res.status).toBe(200);
      expect(res.headers.get('mcp-session-id')).toBeNull();
      await res.json();
      await vi.waitFor(() => expect(close).toHaveBeenCalled());
    });

    it('keeps requiring 2FA of a session where the site enforces it', async () => {
      const before = (await getSiteSettings()).enforce2fa;
      await updateSiteSettings({ enforce2fa: true });
      try {
        const user = await newUser();
        const res = await rawPost(INITIALIZE, { Authorization: `Bearer ${user.token}` });
        expect(res.status).toBe(403);
        expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
          'TWO_FACTOR_SETUP_REQUIRED',
        );
      } finally {
        await updateSiteSettings({ enforce2fa: before });
      }
    });

    it('runs /api/act with a token, by its own scopes', async () => {
      const header = await tokenHeader(['issues:read']);
      const { number } = await createIssue();
      const post = (body: object) =>
        request(app).post('/api/act').set('Authorization', header).set(CSRF).send(body);

      const read = await post({
        action: 'issue.get',
        input: { projectId: ctx.projectId, issueNumber: number },
      });
      expect(read.status).toBe(200);
      expect(read.body.number).toBe(number);

      const write = await post({
        action: 'issue.update',
        input: { projectId: ctx.projectId, issueNumber: number, title: 'x' },
      });
      expect(write.status).toBe(403);
      expect(write.body.error.code).toBe('SCOPE');

      expect((await post({})).status).toBe(400);
      expect((await post({ batch: [] })).status).toBe(400);
      expect((await post({ action: 'attachment.download', input: { id: 'x' } })).status).toBe(400);
    });

    it('answers a raw action over /api/act with 400', async () => {
      const res = await authPost('/api/act', ctx.owner.token, {
        action: 'attachment.upload',
        input: {},
      });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('RAW_ACTION');
    });
  });

  describe('review fixes', () => {
    // Search has a limit per user, so the query table takes a new user every 25 searches
    let searcherId: string | undefined;
    let searches = 0;
    async function searcher(): Promise<string> {
      if (!searcherId || searches >= 25) {
        searcherId = (await newMember()).id;
        searches = 0;
      }
      searches++;
      return searcherId;
    }

    it('takes application/json only, so no body gets past the parser and its limit', async () => {
      const issue = await createIssue();
      const title = `By array ${Date.now()}`;
      const call = {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'act',
          arguments: {
            action: 'comment.add',
            key: issue.key,
            input: { body: title },
          },
        },
      };
      for (const spelling of ['application/json-patch+json', 'text/plain; x=application/json']) {
        const array = await rawPost([call, call, call], { ...ownerAuth, 'Content-Type': spelling });
        expect(array.status, spelling).toBe(415);
        const single = await rawPost(call, { ...ownerAuth, 'Content-Type': spelling });
        expect(single.status, spelling).toBe(415);
      }
      expect(await prisma.comment.count({ where: { body: title } })).toBe(0);

      const charset = await rawPost(INITIALIZE, {
        ...ownerAuth,
        'Content-Type': 'application/json; charset=utf-8',
      });
      expect(charset.status).toBe(200);
      for (const body of ['"text"', '3', 'null']) {
        const res = await fetch(`${base}/api/mcp`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: MCP_ACCEPT, ...ownerAuth },
          body,
        });
        expect(res.status, body).toBe(400);
      }
    });

    it('counts upload toward the act limit', async () => {
      const user = await newUser();
      const c = await asUser(user);
      const batch = Array.from({ length: MAX_BATCH_ITEMS }, () => ({ action: 'nope.nope' }));
      for (let used = 0; used + MAX_BATCH_ITEMS <= ACT_LIMIT.max; used += MAX_BATCH_ITEMS) {
        await callTool(c, 'act', { batch });
      }
      expectRefused(await callTool(c, 'upload', { url: 'https://example.com/a.png' }), 429);
    });

    it('R21: one audit row per write through MCP, with action, ids, outcome and via', async () => {
      const issue = await createIssue();
      const token = `audit-bot-${Date.now()}`;
      const c = await client(await tokenHeader(['issues:write'], ctx.owner, token));
      const rows = () =>
        prisma.auditLog.findMany({ where: { via: token }, orderBy: { createdAt: 'asc' } });

      await callTool(c, 'act', { action: 'issue.get', key: issue.key });
      await callTool(c, 'describe');
      expect(await rows()).toEqual([]);

      await callTool(c, 'act', { action: 'issue.update', key: issue.key, input: { title: 'New' } });
      const [ok] = await rows();
      expect(ok.action).toBe('issue.update');
      expect(ok.details).toMatchObject({
        outcome: 'ok',
        target: { projectId: ctx.projectId, issueNumber: issue.number },
      });

      // A refused delete reads as refused, not as a 200
      await callTool(c, 'act', {
        action: 'page.delete',
        input: { spaceId, pageSlug: 'nothing' },
      });
      const refused = (await rows())[1];
      expect(refused.action).toBe('page.delete');
      expect(refused.details).toMatchObject({ outcome: 'refused', status: 403, code: 'SCOPE' });

      // A key that resolves to nothing is a refused write too
      await callTool(c, 'act', {
        action: 'issue.delete',
        key: `${ctx.projectPrefix}-99999`,
      });
      expect((await rows())[2].details).toMatchObject({
        outcome: 'refused',
        status: 404,
        target: { key: `${ctx.projectPrefix}-99999` },
      });
      expect(await prisma.auditLog.count({ where: { via: token, action: 'create' } })).toBe(0);
    });

    it('R21: a batch writes one row per item that ran, and /api/act a row per action', async () => {
      const token = `audit-batch-${Date.now()}`;
      const header = await tokenHeader(['issues:write'], ctx.owner, token);
      const c = await client(header);
      const create = { action: 'issue.create', input: { projectId: ctx.projectId, title: 'B' } };
      await callTool(c, 'act', {
        batch: [create, { action: 'issue.create', input: { projectId: ctx.projectId } }, create],
      });
      const rows = await prisma.auditLog.findMany({
        where: { via: token },
        orderBy: { createdAt: 'asc' },
      });
      expect(rows.map((r) => [r.action, (r.details as { outcome: string }).outcome])).toEqual([
        ['issue.create', 'ok'],
        ['issue.create', 'refused'],
      ]);

      const session = await authPost('/api/act', ctx.owner.token, {
        action: 'issue.create',
        input: { projectId: ctx.projectId, title: `Act audit ${Date.now()}` },
      });
      expect(session.status).toBe(200);
      await vi.waitFor(async () => {
        const row = await prisma.auditLog.findFirstOrThrow({
          where: { userId: ctx.owner.id, action: 'issue.create', via: null },
          orderBy: { createdAt: 'desc' },
        });
        expect(row.details).toMatchObject({ outcome: 'ok' });
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
      const httpRows = await prisma.auditLog.count({
        where: { resource: 'unknown', userId: ctx.owner.id },
      });
      expect(httpRows).toBe(0);
    });

    it('page.create takes a template of the space, resolved, or says why not', async () => {
      const template = await prisma.pageTemplate.create({
        data: { spaceId, name: 'T', body: 'By {{currentUser.username}}' },
      });
      const c = await asUser(ctx.owner);
      const slug = `from-template-${Date.now()}`;
      const made = await callTool(c, 'act', {
        action: 'page.create',
        input: { spaceId, title: 'From template', slug, templateId: template.id },
      });
      expect(made.isError).toBe(false);
      expect(made.data.body).toBe(`By ${ctx.owner.username}`);

      expectRefused(
        await callTool(c, 'act', {
          action: 'page.create',
          input: { spaceId, title: 'Both', slug: `${slug}-b`, body: 'x', templateId: template.id },
        }),
        400,
      );
      expectRefused(
        await callTool(c, 'act', {
          action: 'page.create',
          input: { spaceId, title: 'None', slug: `${slug}-n`, templateId: 'missing' },
        }),
        404,
      );
    });

    it('pageTemplate.resolve resolves over MCP, with the checks of the route', async () => {
      const c = await asUser(ctx.owner);
      const ok = await callTool(c, 'act', {
        action: 'pageTemplate.resolve',
        input: { body: 'In {{space.slug}}', context: { spaceId } },
      });
      expect(ok.data.body).toBe('In agent-space');

      const stranger = await asUser(await newUser());
      const refused = await callTool(stranger, 'act', {
        action: 'pageTemplate.resolve',
        input: { body: '{{space.name}}', context: { spaceId } },
      });
      expectRefused(refused, 403);
      expect(refused.text).not.toContain('Agent space');
    });

    it('issue.list filters answer 400 naming the valid values, and agree with search', async () => {
      const mark = `filter${Date.now()}`;
      const made = await prisma.issue.create({
        data: {
          projectId: ctx.projectId,
          number: nextNumber--,
          title: `Bug ${mark}`,
          body: '',
          type: 'BUG',
          priority: 'HIGH',
          creatorId: ctx.owner.id,
        },
      });
      const c = await asUser(ctx.owner);
      const list = (input: object) =>
        callTool(c, 'act', {
          action: 'issue.list',
          input: { projectId: ctx.projectId, q: mark, ...input },
        });
      for (const input of [{ type: 'bug' }, { type: 'BUG' }, { priority: 'high' }, { type: '' }]) {
        const { data, isError } = await list(input);
        expect(isError, JSON.stringify(input)).toBe(false);
        expect(data.issues.map((i: { id: string }) => i.id)).toEqual([made.id]);
      }
      expect((await list({ type: 'story' })).data.issues).toEqual([]);

      const wrong = await list({ type: 'nonsense' });
      expectRefused(wrong, 400);
      expect(wrong.data.message).toContain('BUG');

      const rest = await request(app)
        .get(`/api/projects/${ctx.projectId}/issues?priority=nope`)
        .set('Authorization', `Bearer ${ctx.owner.token}`);
      expect(rest.status).toBe(400);

      const search = await callTool(c, 'search', { query: `type:bug ${mark}`, type: 'issues' });
      expect(search.data[0].items.map((i: { title: string }) => i.title)).toEqual([`Bug ${mark}`]);
    });

    it('R22: /api/mcp refuses a session and says to create a token', async () => {
      const auth = { Authorization: `Bearer ${ctx.owner.token}` };
      for (const res of [
        await rawPost(INITIALIZE, auth),
        await fetch(`${base}/api/mcp`, { headers: auth }),
        await fetch(`${base}/api/mcp`, { method: 'DELETE', headers: auth }),
      ]) {
        expect(res.status).toBe(401);
        const body = (await res.json()) as { error: { code: string; message: string } };
        expect(body.error.code).toBe('TOKEN_REQUIRED');
        expect(body.error.message).toContain('token');
      }
      const act = await authPost('/api/act', ctx.owner.token, { action: 'org.list' });
      expect(act.status).toBe(200);
    });

    it('answers a malformed tools/call with a clean error', async () => {
      for (const params of [{}, { name: 42 }, { name: 'act', arguments: 'nope' }]) {
        const res = await rawPost(
          { jsonrpc: '2.0', id: 9, method: 'tools/call', params },
          ownerAuth,
        );
        const text = await res.text();
        const body = JSON.parse(text) as { error: { code: number; message: string }; id: number };
        expect(body.id).toBe(9);
        expect(body.error.code).toBe(-32602);
        expect(text).not.toContain('invalid_type');
        expect(text).not.toContain('expected');
      }
    });

    it('space.list and sprint.list are whole without limit, and pages with data and total', async () => {
      const team = await prisma.team.create({
        data: {
          orgId: ctx.orgId,
          name: 'Many',
          slug: `many-${Date.now()}`,
          members: { create: { userId: ctx.owner.id, role: 'ADMIN' } },
        },
      });
      // One name and one start date for all: only the tie-break keeps pages apart
      await prisma.wikiSpace.createMany({
        data: Array.from({ length: 26 }, (_, i) => ({
          teamId: team.id,
          name: 'Same',
          slug: `s${i}`,
        })),
      });
      const project = await prisma.project.create({
        data: { teamId: team.id, name: 'Many', slug: 'many', prefix: 'MNY' },
      });
      const start = new Date(2026, 0, 1);
      await prisma.sprint.createMany({
        data: Array.from({ length: 26 }, (_, i) => ({
          projectId: project.id,
          name: `Sprint ${i}`,
          startDate: start,
          endDate: new Date(2026, 1, 1),
        })),
      });
      try {
        const c = await asUser(ctx.owner);
        const lists = {
          'space.list': (input: object = {}) =>
            callTool(c, 'act', { action: 'space.list', input: { teamId: team.id, ...input } }),
          'sprint.list': (input: object = {}) =>
            callTool(c, 'act', {
              action: 'sprint.list',
              input: { projectId: project.id, ...input },
            }),
        };
        for (const [name, list] of Object.entries(lists)) {
          const whole = (await list()).data as Array<{ id: string }>;
          expect(whole, name).toHaveLength(26);

          const seen: string[] = [];
          for (let offset = 0; offset < 26; offset += 5) {
            const { data } = await list({ limit: 5, offset });
            expect(data.total, name).toBe(26);
            expect(data.limit, name).toBe(5);
            expect(data.offset, name).toBe(offset);
            seen.push(...data.data.map((item: { id: string }) => item.id));
          }
          expect(seen, name).toHaveLength(26);
          expect(new Set(seen).size, name).toBe(26);

          expectRefused(await list({ limit: 0 }), 400);
          expectRefused(await list({ limit: 101 }), 400);
        }

        const rest = await request(app)
          .get(`/api/wiki/team/${team.id}/spaces`)
          .set('Authorization', `Bearer ${ctx.owner.token}`);
        expect(rest.body).toHaveLength(26);
        const restLimit = await request(app)
          .get(`/api/projects/${project.id}/sprints?limit=2`)
          .set('Authorization', `Bearer ${ctx.owner.token}`);
        expect(restLimit.body.data).toHaveLength(2);
        expect(restLimit.body.total).toBe(26);
        const described = await callTool(c, 'describe', { action: 'sprint.list' });
        expect(described.data.summary).toContain('total');
        const spaceList = await callTool(c, 'describe', { action: 'space.list' });
        expect(spaceList.data.summary).toContain('total');
        expect(spaceList.data.summary).not.toContain('Over MCP');
      } finally {
        await prisma.project.delete({ where: { id: project.id } });
        await prisma.team.delete({ where: { id: team.id } });
      }
    });

    it('audit rows hold only known fields, within a cap, whatever a caller sends', async () => {
      const issue = await createIssue();
      const stranger = await newUser();
      const token = `audit-stuff-${Date.now()}`;
      const header = await tokenHeaderFor(stranger, MINTABLE_SCOPES, token);
      const input: Record<string, unknown> = {
        projectId: ctx.projectId,
        issueNumber: issue.number,
      };
      for (let i = 0; i < 5000; i++) input[`f${i}Id`] = `value-${i}`;
      const refused = await callTool(await client(header), 'act', {
        action: 'issue.delete',
        input,
      });
      expectRefused(refused, 403);
      const huge = await callTool(await client(header), 'act', {
        action: 'issue.delete',
        input: { projectId: 'x'.repeat(100_000), issueNumber: issue.number },
      });
      expect(huge.isError).toBe(true);
      const rows = await prisma.auditLog.findMany({ where: { via: token } });
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(JSON.stringify(row.details).length).toBeLessThan(3000);
        expect(JSON.stringify(row.details)).not.toContain('f1Id');
      }
      expect((rows[0].details as { target: object }).target).toMatchObject({
        issueNumber: issue.number,
      });
    });

    it('audit rows name the real target of uploads, lists and what was created', async () => {
      const issue = await createIssue();
      const token = `audit-target-${Date.now()}`;
      const c = await client(await tokenHeaderFor(ctx.owner, MINTABLE_SCOPES, token));
      const lastRow = async (action: string) =>
        prisma.auditLog.findFirstOrThrow({
          where: { via: token, action },
          orderBy: { createdAt: 'desc' },
        });
      const file = { filename: 'a.png', mimeType: 'image/png', size: 8 };

      await callTool(c, 'upload', { ...file, target: issue.key });
      expect((await lastRow('attachment.createUploadUrl')).details).toMatchObject({
        outcome: 'ok',
        target: { issueKey: issue.key },
      });

      await callTool(c, 'upload', { url: 'http://127.0.0.1/x', target: issue.key });
      expect((await lastRow('attachment.fromUrl')).details).toMatchObject({
        outcome: 'refused',
        target: { issueKey: issue.key, url: 'http://127.0.0.1/x' },
      });

      expectRefused(await callTool(c, 'upload', { ...file, target: 'not a key' }), 400);
      expect((await lastRow('attachment.createUploadUrl')).details).toMatchObject({
        outcome: 'refused',
        code: 'INVALID_KEY',
        target: { key: 'not a key' },
      });

      const created = await callTool(c, 'act', {
        action: 'issue.create',
        input: { projectId: ctx.projectId, title: 'Audited' },
      });
      expect((await lastRow('issue.create')).details).toMatchObject({
        target: {
          projectId: ctx.projectId,
          number: created.data.number,
          resultId: created.data.id,
        },
      });

      const ids = Array.from({ length: 60 }, (_, i) => `issue-${i}`);
      await callTool(c, 'act', {
        action: 'issue.bulkUpdate',
        input: { projectId: ctx.projectId, issueIds: ids, updates: { priority: 'LOW' } },
      });
      const bulk = (await lastRow('issue.bulkUpdate')).details as {
        target: { issueIds: string[]; issueIdsCount: number };
      };
      expect(bulk.target.issueIds.slice(0, 2)).toEqual(['issue-0', 'issue-1']);
      expect(bulk.target.issueIdsCount).toBe(60);

      const sprint = await prisma.sprint.create({
        data: {
          projectId: ctx.projectId,
          name: 'Audited',
          startDate: new Date(),
          endDate: new Date(Date.now() + 86_400_000),
        },
      });
      const one = await prisma.issue.findFirstOrThrow({ where: { projectId: ctx.projectId } });
      await callTool(c, 'act', {
        action: 'sprint.addIssues',
        input: { projectId: ctx.projectId, sprintId: sprint.id, issueIds: [one.id] },
      });
      expect((await lastRow('sprint.addIssues')).details).toMatchObject({
        target: { sprintId: sprint.id, issueIds: [one.id] },
      });
    });

    it('a 429 on a write writes a refused row, for one action and for a batch', async () => {
      const user = await newUser();
      const token = `audit-429-${Date.now()}`;
      const c = await client(await tokenHeaderFor(user, MINTABLE_SCOPES, token));
      const unknown = Array.from({ length: MAX_BATCH_ITEMS }, () => ({ action: 'nope.nope' }));
      for (let used = 0; used + MAX_BATCH_ITEMS <= ACT_LIMIT.max; used += MAX_BATCH_ITEMS) {
        await callTool(c, 'act', { batch: unknown });
      }
      const create = { action: 'issue.create', input: { projectId: ctx.projectId, title: 'x' } };
      expectRefused(await callTool(c, 'act', create), 429);
      expectRefused(await callTool(c, 'act', { batch: [create, create] }), 429);
      expectRefused(await callTool(c, 'upload', { url: 'https://example.com/a.png' }), 429);
      const rows = await prisma.auditLog.findMany({
        where: { via: token },
        orderBy: { createdAt: 'asc' },
      });
      expect(rows.map((r) => r.action)).toEqual([
        'issue.create',
        'act.batch',
        'attachment.fromUrl',
      ]);
      for (const row of rows) {
        expect(row.details).toMatchObject({ outcome: 'refused', status: 429 });
      }
      expect((rows[1].details as { target: object }).target).toMatchObject({
        items: 2,
        actions: ['issue.create'],
      });
    });

    it('issue.hydrateList takes typed filters on act and over REST', async () => {
      const c = await asUser(ctx.owner);
      const hydrate = (input: object) =>
        callTool(c, 'act', {
          action: 'issue.hydrateList',
          input: { projectId: ctx.projectId, ...input },
        });
      const ok = await hydrate({ q: 'nothing-here', type: 'bug', limit: 5 });
      expect(ok.isError).toBe(false);
      expect(ok.data.issues).toBeDefined();
      expectRefused(await hydrate({ type: 'NOPE' }), 400);
      expectRefused(await hydrate({ nonsense: 'x' }), 400);

      const described = await callTool(c, 'describe', { action: 'issue.hydrateList' });
      expect(described.data.input.additionalProperties).toBeUndefined();
      expect(Object.keys(described.data.input.properties)).toContain('priority');

      const get = (query: string) =>
        request(app)
          .get(`/api/projects/${ctx.projectId}/issues/hydrate?${query}`)
          .set('Authorization', `Bearer ${ctx.owner.token}`);
      expect((await get('type=NOPE')).status).toBe(400);
      expect((await get('type=BUG&limit=5')).status).toBe(200);
    });

    it('takes binary files with NUL bytes, and refuses NUL text on any /api route', async () => {
      const bytes = Buffer.from([0, 1, 0, 2, 0, 3, 0, 4]);
      const { data } = await callTool(await asUser(ctx.owner), 'upload', {
        filename: 'nul.png',
        mimeType: 'image/png',
        size: bytes.length,
      });
      const put = await fetch(data.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'image/png' },
        body: bytes,
      });
      expect(put.status).toBe(201);
      const multipart = await request(app)
        .post('/api/attachments')
        .set('Authorization', `Bearer ${ctx.owner.token}`)
        .set(CSRF)
        .attach('file', bytes, { filename: 'multi.png', contentType: 'image/png' });
      expect(multipart.status).toBe(201);

      const legacy = await request(app)
        .post('/api/saved-filters')
        .set('Authorization', `Bearer ${ctx.owner.token}`)
        .set(CSRF)
        .send({ name: 'a\u0000b', filter: {} });
      expect(legacy.status).toBe(400);
      expect(legacy.body.error.code).toBe('INVALID_TEXT');
      const inQuery = await request(app)
        .get('/api/notifications?x=a%00b')
        .set('Authorization', `Bearer ${ctx.owner.token}`);
      expect(inQuery.status).toBe(400);
      const inPath = await request(app)
        .get('/api/users/a%00b')
        .set('Authorization', `Bearer ${ctx.owner.token}`);
      expect(inPath.status).toBe(400);
    });

    it('survives deeply nested input', async () => {
      const deep = `${'{"a":'.repeat(400_000)}1${'}'.repeat(400_000)}`;
      const res = await fetch(`${base}/api/act`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ctx.owner.token}`,
          ...CSRF,
        },
        body: `{"action":"org.list","input":${deep}}`,
      });
      expect(res.status).toBeLessThan(500);
    });

    it('audits the proxy-aware address over REST, not a header anyone can send', async () => {
      const spoof = `6.6.${Date.now() % 250}.${Math.floor(Math.random() * 250)}`;
      const res = await request(app)
        .post(`/api/projects/${ctx.projectId}/issues`)
        .set('Authorization', `Bearer ${ctx.owner.token}`)
        .set(CSRF)
        .set('X-Forwarded-For', spoof)
        .send({ title: `Spoof ${Date.now()}` });
      expect(res.status).toBe(201);
      await vi.waitFor(async () => {
        const rows = await prisma.auditLog.findMany({
          where: { userId: ctx.owner.id },
          orderBy: { createdAt: 'desc' },
          take: 3,
        });
        expect(rows.some((row) => row.details !== null)).toBe(true);
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
      const spoofed = await prisma.auditLog.count({
        where: { details: { path: ['ipAddress'], equals: spoof } },
      });
      expect(spoofed).toBe(0);
    });

    it('logs the origin and path of a URL, never its query', async () => {
      const token = `audit-url-${Date.now()}`;
      const c = await client(await tokenHeaderFor(ctx.owner, MINTABLE_SCOPES, token));
      await callTool(c, 'upload', {
        url: 'https://user:pw@localhost/x/y.png?X-Amz-Signature=secret#frag',
      });
      await callTool(c, 'act', {
        action: 'issue.delete',
        key: `https://localhost/org/team/project/issues/99999?sig=secret`,
      });
      const rows = await prisma.auditLog.findMany({ where: { via: token } });
      expect(rows).toHaveLength(2);
      const text = JSON.stringify(rows.map((row) => row.details));
      expect(text).toContain('https://localhost/x/y.png');
      expect(text).not.toContain('secret');
      expect(text).not.toContain('user:pw');
    });

    it('refuses NUL in the fields and the file name of a multipart upload', async () => {
      const bytes = Buffer.from([1, 2, 3]);
      const post = () =>
        request(app)
          .post('/api/attachments')
          .set('Authorization', `Bearer ${ctx.owner.token}`)
          .set(CSRF);
      for (const field of ['issueId', 'pageId', 'commentId']) {
        const res = await post()
          .field(field, 'a\u0000b')
          .attach('file', bytes, { filename: 'a.png', contentType: 'image/png' });
        expect(res.status, field).toBe(400);
      }
      const named = await post().attach('file', bytes, {
        filename: 'a\u0000b.png',
        contentType: 'image/png',
      });
      expect(named.status).toBeLessThan(500);
    });

    it('reports one problem for a limit that is no number', async () => {
      const answer = await callTool(await asUser(ctx.owner), 'act', {
        action: 'sprint.list',
        input: { projectId: ctx.projectId, limit: 'x' },
      });
      expectRefused(answer, 400);
      expect(answer.data.message).toContain('whole number');
      expect(answer.data.message).not.toContain('too large');
    });

    it('takes digits past the column as text in q, on issue.list and its hydration', async () => {
      const title = `Order 2147483648 ${Date.now()}`;
      await createIssue(title);
      const c = await asUser(ctx.owner);
      const list = await callTool(c, 'act', {
        action: 'issue.list',
        input: { projectId: ctx.projectId, q: '2147483648' },
      });
      expect(list.isError).toBe(false);
      expect(list.data.issues.map((i: { title: string }) => i.title)).toContain(title);
      const hydrated = await callTool(c, 'act', {
        action: 'issue.hydrateList',
        input: { projectId: ctx.projectId, q: '2147483648' },
      });
      expect(hydrated.data.issues.issues.map((i: { title: string }) => i.title)).toContain(title);
    });

    it('answers 400 on a value out of range in a query, on every way in', async () => {
      const c = await asUser(ctx.owner);
      const queries = ['number = 2147483648', 'storyPoints = 99999999999', 'type = NOPE'];
      for (const q of queries) {
        const list = await callTool(c, 'act', {
          action: 'issue.list',
          input: { projectId: ctx.projectId, q },
        });
        expectRefused(list, 400, 'INVALID_QUERY');
        expectRefused(
          await callTool(c, 'act', {
            action: 'issue.hydrateList',
            input: { projectId: ctx.projectId, q },
          }),
          400,
          'INVALID_QUERY',
        );
        expectRefused(await callTool(c, 'search', { query: q }), 400, 'INVALID_QUERY');
        const rest = await request(app)
          .get(`/api/search?q=${encodeURIComponent(q)}`)
          .set('Authorization', `Bearer ${ctx.owner.token}`);
        expect(rest.status, q).toBe(400);
      }
    });

    it('never answers 500 on a query, across fields, operators and values', async () => {
      const fields = [
        ...Object.keys(issueFieldRegistry),
        'constructor',
        '__proto__',
        'toString',
        'hasOwnProperty',
      ];
      const operators = ['=', '!=', '>', '<', '>=', '<=', '~'];
      const values = [
        '2147483648',
        '-2147483649',
        '1.5',
        '5',
        '"abc"',
        'null',
        'now()',
        '"2026-01-01"',
        '"0000-01-01"',
        '"9999-12-31"',
        '"10000-01-01"',
        'constructor()',
        '__proto__()',
      ];
      const queries = fields.flatMap((field) => [
        ...operators.flatMap((op) => values.map((value) => `${field} ${op} ${value}`)),
        `${field} IN ("a", "b")`,
        `${field} NOT IN (1, 2147483648)`,
        `${field} IN (null)`,
      ]);
      const session = { userId: ctx.owner.id, channel: 'ui' as const };
      const failures: string[] = [];
      for (const q of queries) {
        for (const [action, input] of [
          ['issue.list', { projectId: ctx.projectId, q }],
          ['search.run', { query: q, type: 'issues' }],
        ] as const) {
          // A user of their own for the search limit: this runs far past 30 a minute
          const asCaller =
            action === 'search.run' ? { ...session, userId: await searcher() } : session;
          try {
            await executeAction(action, input, asCaller);
          } catch (err) {
            if (!(err instanceof AppError) || err.statusCode >= 500) {
              failures.push(`${action} ${q}: ${String((err as Error).message).slice(0, 120)}`);
            }
          }
        }
      }
      expect(failures).toEqual([]);
    }, 120_000);

    it('takes long chains of OR and AND, and refuses nesting past the cap', async () => {
      const c = await asUser(ctx.owner);
      const list = (q: string) =>
        callTool(c, 'act', { action: 'issue.list', input: { projectId: ctx.projectId, q } });
      const terms = (op: string, n: number) =>
        Array.from({ length: n }, (_, i) => `number=${i + 1}`).join(` ${op} `);
      for (const q of [
        `${terms('OR', 70)}`,
        `${terms('AND', 70)}`,
        `(${terms('AND', 30)}) OR (${terms('OR', 30)})`,
      ]) {
        const answer = await list(q);
        expect(answer.isError, q.slice(0, 40)).toBe(false);
      }
      const deep = `${'NOT ('.repeat(100)}number = 1${')'.repeat(100)}`;
      expectRefused(await list(deep), 400, 'INVALID_QUERY');
      expectRefused(
        await callTool(c, 'search', { query: deep, type: 'issues' }),
        400,
        'INVALID_QUERY',
      );
      expectRefused(
        await callTool(c, 'act', {
          action: 'issue.hydrateList',
          input: { projectId: ctx.projectId, q: deep },
        }),
        400,
        'INVALID_QUERY',
      );
    });

    it('surfaces a failed issue list on hydrate, as issue.list does', async () => {
      const issues = await import('../modules/issues/issues.service');
      vi.spyOn(issues, 'listIssues').mockRejectedValue(new Error('failed in the database'));
      const res = await request(app)
        .get(`/api/projects/${ctx.projectId}/issues/hydrate`)
        .set('Authorization', `Bearer ${ctx.owner.token}`);
      expect(res.status).toBe(500);
      expect(res.body.error.message).toBe('Internal server error');
    });

    it('keeps limit, offset and every filter in the list cache key', async () => {
      const mark = `cachekey${Date.now()}`;
      for (let i = 0; i < 6; i++) await createIssue(`${mark} ${i}`);
      const c = await asUser(ctx.owner);
      const list = (input: object) =>
        callTool(c, 'act', {
          action: 'issue.list',
          input: { projectId: ctx.projectId, q: mark, ...input },
        });
      expect((await list({ limit: 1 })).data.issues).toHaveLength(1);
      expect((await list({ limit: 5 })).data.issues).toHaveLength(5);
      const [first] = (await list({ limit: 1, offset: 0 })).data.issues;
      const [second] = (await list({ limit: 1, offset: 1 })).data.issues;
      expect(first.id).not.toBe(second.id);

      // Text with the separator of a joined key can't pass for another filter
      await createIssue(`${mark}:BUG`);
      const plain = await list({ q: `${mark}:BUG`, limit: 5 });
      const filtered = await list({ q: mark, type: 'BUG', limit: 5 });
      expect(plain.data.total).not.toBe(filtered.data.total);
    });

    it('reads a lone title ~ "x" as a query on list and search', async () => {
      const mark = `tilde${Date.now()}`;
      await createIssue(`Word ${mark} word`);
      const c = await asUser(ctx.owner);
      const q = `title ~ "${mark}"`;
      const list = await callTool(c, 'act', {
        action: 'issue.list',
        input: { projectId: ctx.projectId, q },
      });
      expect(list.data.issues.map((i: { title: string }) => i.title)).toEqual([
        `Word ${mark} word`,
      ]);
      const search = await callTool(c, 'search', { query: q, type: 'issues' });
      expect(search.data[0].items).toHaveLength(1);
    });

    it('refuses a rule on an unknown field, and an old one stops only itself', async () => {
      const header = { Authorization: `Bearer ${ctx.owner.token}`, ...CSRF };
      for (const condition of ['constructor = 1', '__proto__ = 1', 'nonsense = 1']) {
        const res = await request(app)
          .post(`/api/projects/${ctx.projectId}/automation-rules`)
          .set(header)
          .send({
            name: 'Bad',
            trigger: 'issue:created',
            condition,
            actions: [{ type: 'add_label', name: 'bad' }],
          });
        expect(res.status, condition).toBe(400);
      }
      const label = `ran-${Date.now()}`;
      // Written before validation knew better
      const broken = await prisma.automationRule.create({
        data: {
          projectId: ctx.projectId,
          name: 'Old broken',
          trigger: 'issue:created',
          condition: 'constructor = 1',
          actions: [{ type: 'add_label', name: 'never' }],
        },
      });
      const working = await prisma.automationRule.create({
        data: {
          projectId: ctx.projectId,
          name: 'After it',
          trigger: 'issue:created',
          condition: 'type = Bug',
          actions: [{ type: 'add_label', name: label }],
        },
      });
      try {
        const created = await authPost(`/api/projects/${ctx.projectId}/issues`, ctx.owner.token, {
          title: 'Automated',
          type: 'BUG',
        });
        expect(created.status).toBe(201);
        await vi.waitFor(async () => {
          const issue = await prisma.issue.findUniqueOrThrow({
            where: { id: created.body.id },
            include: { labels: true },
          });
          expect(issue.labels.map((l) => l.name)).toEqual([label]);
        });
      } finally {
        await prisma.automationRule.deleteMany({ where: { id: { in: [broken.id, working.id] } } });
      }
    });

    it('keeps the free text of a mixed query, in either order, on list and search', async () => {
      const word = `salt${Date.now()}`;
      const make = (title: string, type: 'BUG' | 'TASK') =>
        prisma.issue.create({
          data: {
            projectId: ctx.projectId,
            number: nextNumber--,
            title,
            body: '',
            type,
            creatorId: ctx.owner.id,
          },
        });
      await make(`Bug with ${word}`, 'BUG');
      await make(`Task with ${word}`, 'TASK');
      await make(`Bug without it ${Date.now()}`, 'BUG');
      const c = await asUser(ctx.owner);
      for (const q of [`type:bug ${word}`, `${word} type:bug`]) {
        const list = await callTool(c, 'act', {
          action: 'issue.list',
          input: { projectId: ctx.projectId, q },
        });
        expect(
          list.data.issues.map((i: { title: string }) => i.title),
          q,
        ).toEqual([`Bug with ${word}`]);
        const hydrated = await callTool(c, 'act', {
          action: 'issue.hydrateList',
          input: { projectId: ctx.projectId, q },
        });
        expect(hydrated.data.issues.total, q).toBe(1);

        const search = await callTool(c, 'search', { query: q, type: 'issues' });
        expect(
          search.data[0].items.map((i: { title: string }) => i.title),
          q,
        ).toEqual([`Bug with ${word}`]);
        const rest = await request(app)
          .get(`/api/search?type=issues&q=${encodeURIComponent(q)}`)
          .set('Authorization', `Bearer ${ctx.owner.token}`);
        expect(
          rest.body[0].items.map((i: { title: string }) => i.title),
          q,
        ).toEqual([`Bug with ${word}`]);
      }

      // Text matched only by LIKE, which full text can't stem into, still needs the filter
      const partial = word.slice(2);
      const like = await callTool(c, 'search', { query: `type:bug ${partial}`, type: 'issues' });
      expect(like.data[0].items.map((i: { title: string }) => i.title)).toEqual([
        `Bug with ${word}`,
      ]);
    });

    it('refuses text and unknown functions in a rule, and a stored one never fires', async () => {
      const rulesPath = `/api/projects/${ctx.projectId}/automation-rules`;
      const header = { Authorization: `Bearer ${ctx.owner.token}`, ...CSRF };
      const body = (condition: string) => ({
        name: 'Bad',
        trigger: 'issue:created',
        condition,
        actions: [{ type: 'add_label', name: 'bad' }],
      });
      const bad = ['garbage ((', 'just words', 'type:bug words', 'type = nope()'];
      for (const condition of bad) {
        const res = await request(app).post(rulesPath).set(header).send(body(condition));
        expect(res.status, condition).toBe(400);
      }
      const good = await request(app).post(rulesPath).set(header).send(body('type = Bug'));
      expect(good.status).toBe(201);
      for (const condition of bad) {
        const res = await request(app)
          .patch(`${rulesPath}/${good.body.id}`)
          .set(header)
          .send({ condition });
        expect(res.status, condition).toBe(400);
      }
      await prisma.automationRule.delete({ where: { id: good.body.id } });

      const label = `fired-${Date.now()}`;
      const stored = await prisma.automationRule.create({
        data: {
          projectId: ctx.projectId,
          name: 'Stored text',
          trigger: 'issue:created',
          condition: 'garbage ((',
          actions: [{ type: 'add_label', name: label }],
        },
      });
      try {
        const created = await authPost(`/api/projects/${ctx.projectId}/issues`, ctx.owner.token, {
          title: 'Not for the stored rule',
        });
        expect(created.status).toBe(201);
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(await prisma.label.count({ where: { name: label } })).toBe(0);
      } finally {
        await prisma.automationRule.delete({ where: { id: stored.id } });
      }
    });

    it('prunes the shared page tree per viewer, whoever filled the cache', async () => {
      const space = await prisma.wikiSpace.create({
        data: { teamId: ctx.teamId, name: 'Tree', slug: `tree-${Date.now()}` },
      });
      const title = `Tree secret ${Date.now()}`;
      const open = await createPage('open-root', 'x', space.id);
      const later = await createPage('restricted-later', 'x', space.id);
      await prisma.page.update({ where: { id: later.id }, data: { title: `${title} later` } });
      const hidden = await createPage('hidden', 'x', space.id);
      await prisma.page.update({ where: { id: hidden.id }, data: { title } });
      await prisma.page.create({
        data: {
          spaceId: space.id,
          title: `${title} child`,
          slug: 'child',
          body: 'x',
          parentId: hidden.id,
        },
      });
      await prisma.pageRestriction.create({
        data: { pageId: hidden.id, type: 'VIEW', userId: ctx.owner.id },
      });
      const member = await newMember();
      const tree = (user: TestUser) =>
        request(app)
          .get(`/api/wiki/spaces/${space.id}/tree`)
          .set('Authorization', `Bearer ${user.token}`);

      await cacheInvalidate(`wiki:tree:${space.id}`);
      // The allowed viewer fills the cache with the whole tree
      expect(JSON.stringify((await tree(ctx.owner)).body)).toContain(`${title} child`);
      expect(await cacheGet(`wiki:tree:${space.id}`)).not.toBeNull();
      const seen = JSON.stringify((await tree(member)).body);
      expect(seen).toContain(open.slug);
      expect(seen).not.toContain(`"title":"${title}"`);
      expect(seen).not.toContain(`${title} child`);
      const overMcp = await callTool(await asUser(member), 'act', {
        action: 'page.tree',
        input: { spaceId: space.id },
      });
      expect(overMcp.text).not.toContain(`${title} child`);

      // A restriction added while the entry is cached counts at once
      await prisma.pageRestriction.create({
        data: { pageId: later.id, type: 'VIEW', userId: ctx.owner.id },
      });
      expect(JSON.stringify((await tree(member)).body)).not.toContain(`${title} later`);
      expect(JSON.stringify((await tree(ctx.owner)).body)).toContain(`${title} later`);
    });

    it('keeps a query to the project issue.list was authorized on', async () => {
      const other = await createTestContext(`mcpother${Date.now()}`);
      try {
        await prisma.issue.create({
          data: {
            projectId: other.projectId,
            number: 1,
            title: 'Secret of another org',
            body: '',
            creatorId: other.owner.id,
          },
        });
        const c = await asUser(ctx.owner);
        for (const q of [
          `project = "${other.projectId}"`,
          `project = "${other.projectId}" OR title ~ "Secret"`,
          `NOT project = "${ctx.projectId}"`,
          `project IN ("${other.projectId}")`,
        ]) {
          const { text } = await callTool(c, 'act', {
            action: 'issue.list',
            input: { projectId: ctx.projectId, q },
          });
          expect(text, q).not.toContain('Secret of another org');
          const hydrated = await callTool(c, 'act', {
            action: 'issue.hydrateList',
            input: { projectId: ctx.projectId, q },
          });
          expect(hydrated.text, q).not.toContain('Secret of another org');
        }
      } finally {
        await cleanupTestContext(other);
      }
    });

    it('answers 400 naming an unknown field on the act path, and REST still drops it', async () => {
      const { number, key } = await createIssue('Unchanged');
      const c = await asUser(ctx.owner);
      const answer = await callTool(c, 'act', {
        action: 'issue.update',
        key,
        input: { titel: 'x' },
      });
      expectRefused(answer, 400);
      expect(answer.data.message).toContain('titel');

      const batch = await authPost('/api/act', ctx.owner.token, {
        action: 'issue.update',
        input: { projectId: ctx.projectId, issueNumber: number, titel: 'x' },
      });
      expect(batch.status).toBe(400);

      // A refused caller still sees the refusal, not the field check
      const stranger = await asUser(await newUser());
      expectRefused(
        await callTool(stranger, 'act', {
          action: 'issue.update',
          input: { projectId: ctx.projectId, issueNumber: number, titel: 'x' },
        }),
        403,
      );

      const rest = await request(app)
        .patch(`/api/projects/${ctx.projectId}/issues/${number}`)
        .set('Authorization', `Bearer ${ctx.owner.token}`)
        .set(CSRF)
        .send({ titel: 'x' });
      expect(rest.status).toBe(200);
    });

    it('builds uploadUrl from the configured site origin when there is one', async () => {
      vi.stubEnv('FRONTEND_URL', 'https://axiom.example/');
      try {
        const { data } = await callTool(await asUser(ctx.owner), 'upload', {
          filename: 'a.png',
          mimeType: 'image/png',
          size: 8,
        });
        expect(data.uploadUrl.startsWith('https://axiom.example/api/uploads/')).toBe(true);
        expect(data.curl).toContain('https://axiom.example/api/uploads/');
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it('publishes the real enum of linkType, and no default for a catch field', async () => {
      const c = await asUser(ctx.owner);
      const link = await callTool(c, 'describe', { action: 'pageIssueLink.add' });
      expect(link.text).toContain('EMBED');
      expect(link.text).not.toContain('""');
      expect(link.data.input.properties.linkType.default).toBeUndefined();
      expect(link.data.input.properties.linkType.enum).toEqual(['EMBED', 'MENTION']);
      expect(link.data.input.required).toContain('linkType');
      const pageForLink = await createPage(`link-${Date.now()}`);
      const missing = await callTool(c, 'act', {
        action: 'pageIssueLink.add',
        input: { pageId: pageForLink.id, issueId: 'x' },
      });
      expectRefused(missing, 400);
      expect(missing.data.message).toContain('EMBED or MENTION');
      expect(link.data.input.properties.issueId.default).toBeUndefined();
      const diff = await callTool(c, 'describe', { action: 'page.diff' });
      expect(JSON.stringify(diff.data.input)).not.toContain('"default":""');
      const comment = await callTool(c, 'describe', { action: 'comment.update' });
      expect(comment.data.input.properties.body.default).toBeUndefined();
    });

    it('answers 400 on NUL and on a number past the column, over REST and act', async () => {
      const { key, number } = await createIssue();
      const c = await asUser(ctx.owner);
      const cases: Array<[string, Record<string, unknown>]> = [
        ['issue.get', { projectId: 'a\u0000b', issueNumber: 1 }],
        ['issue.create', { projectId: ctx.projectId, title: 'a\u0000b' }],
        ['comment.add', { projectId: ctx.projectId, issueNumber: number, body: 'a\u0000b' }],
        ['search.run', { query: 'a\u0000b' }],
        ['issue.get', { projectId: ctx.projectId, issueNumber: 2 ** 31 }],
        ['issue.get', { projectId: ctx.projectId, issueNumber: String(2 ** 31) }],
      ];
      for (const [action, input] of cases) {
        expectRefused(await callTool(c, 'act', { action, input }), 400);
      }
      const { token } = ctx.owner;
      const restCases = [
        request(app).get(`/api/projects/a%00b/issues/1`),
        request(app).get(`/api/projects/${ctx.projectId}/issues/${2 ** 31}`),
        request(app).get('/api/search?q=a%00b'),
      ];
      for (const req of restCases) {
        expect((await req.set('Authorization', `Bearer ${token}`)).status).toBe(400);
      }
      const title = await authPost(`/api/projects/${ctx.projectId}/issues`, token, {
        title: 'a\u0000b',
      });
      expect(title.status).toBe(400);
      expect((await callTool(c, 'read', { keys: [`${key}\u0000`] })).data.items[0].error.code).toBe(
        'INVALID_KEY',
      );
    });
  });

  // ─── From mcp-session.test.ts: a message could only reach its owner's SSE session ─────
  describe('identity per request', () => {
    it('runs as whoever authenticated this request, whatever session it names', async () => {
      const { number } = await createIssue('Only the team');
      const stranger = await newUser();
      const call = {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'act',
          arguments: {
            action: 'issue.get',
            input: { projectId: ctx.projectId, issueNumber: number },
          },
        },
      };
      const asStranger = await rawPost(call, {
        Authorization: await tokenHeaderFor(stranger),
        'Mcp-Session-Id': 'the-session-of-the-owner',
      });
      const text = await asStranger.text();
      expect(text).toContain('isError');
      expect(text).not.toContain('Only the team');

      const asOwner = await rawPost(call, ownerAuth);
      expect(await asOwner.text()).toContain('Only the team');
    });

    it('stops working the moment a user is deactivated or a token removed', async () => {
      const member = await newMember();
      const header = await tokenHeader(['issues:read'], member);
      const c = await client(header);
      const list = { action: 'issue.list', input: { projectId: ctx.projectId } };
      expect((await callTool(c, 'act', list)).isError).toBe(false);

      await prisma.user.update({ where: { id: member.id }, data: { deactivatedAt: new Date() } });
      await expect(callTool(c, 'act', list)).rejects.toThrow();
      const raw = await rawPost(INITIALIZE, { Authorization: header });
      expect(raw.status).toBe(403);
      expect(((await raw.json()) as { error: { code: string } }).error.code).toBe(
        'ACCOUNT_DEACTIVATED',
      );
      await prisma.user.update({ where: { id: member.id }, data: { deactivatedAt: null } });

      await prisma.apiToken.deleteMany({ where: { userId: member.id } });
      await expect(callTool(c, 'act', list)).rejects.toThrow();
    });
  });

  // ─── From mcp.test.ts ─────────────────────────────────────────────────────────────────
  describe('security cases of the old server', () => {
    const slugPage = (slug: string, inSpace = spaceId) => ({ spaceId: inSpace, pageSlug: slug });

    it('page.update enforces edit permission, and the owner writes a plain EDIT', async () => {
      const page = await createPage(`edit-${Date.now()}`);
      const viewer = await newMember();
      await prisma.orgMembership.update({
        where: { userId_orgId: { userId: viewer.id, orgId: ctx.orgId } },
        data: { role: 'VIEWER' },
      });
      // Team MEMBER would grant wiki:edit on its own: a viewer has no team role
      await prisma.teamMembership.deleteMany({ where: { userId: viewer.id } });

      const refused = await callTool(await asUser(viewer), 'act', {
        action: 'page.update',
        input: { ...slugPage(page.slug), body: 'hacked' },
      });
      expect(refused.isError).toBe(true);
      expect((await prisma.page.findUniqueOrThrow({ where: { id: page.id } })).body).toBe('before');

      const ok = await callTool(await asUser(ctx.owner), 'act', {
        action: 'page.update',
        input: { ...slugPage(page.slug), body: 'after' },
      });
      expect(ok.isError).toBe(false);
      const versions = await prisma.pageVersion.findMany({ where: { pageId: page.id } });
      expect(versions.map((v) => v.kind)).toEqual(['EDIT']);
      expect((await prisma.page.findUniqueOrThrow({ where: { id: page.id } })).body).toBe('after');
    });

    it('page writes require EDIT access to the space', async () => {
      const space = await prisma.wikiSpace.create({
        data: { teamId: ctx.teamId, name: 'Locked', slug: `locked-${Date.now()}` },
      });
      const page = await createPage('locked-page', 'before', space.id);
      // A team member, so the org and page checks pass, who may only view this space
      const reader = await newMember();
      await prisma.spacePermission.create({
        data: { spaceId: space.id, userId: reader.id, level: 'VIEW' },
      });
      const c = await asUser(reader);
      const update = await callTool(c, 'act', {
        action: 'page.update',
        input: { ...slugPage('locked-page', space.id), body: 'changed by a reader' },
      });
      const create = await callTool(c, 'act', {
        action: 'page.create',
        input: { spaceId: space.id, title: 'Sneaky', slug: 'sneaky', body: 'x' },
      });
      expect(update.isError).toBe(true);
      expect(create.isError).toBe(true);
      expect((await prisma.page.findUniqueOrThrow({ where: { id: page.id } })).body).toBe('before');
      expect(await prisma.page.count({ where: { spaceId: space.id, slug: 'sneaky' } })).toBe(0);
    });

    it('denies issue.delete and page.delete in another org', async () => {
      const { number } = await createIssue('Keep me');
      const page = await createPage(`keep-${Date.now()}`);
      const c = await asUser(await newUser());
      const issue = await callTool(c, 'act', {
        action: 'issue.delete',
        input: { projectId: ctx.projectId, issueNumber: number },
      });
      const wiki = await callTool(c, 'act', {
        action: 'page.delete',
        input: slugPage(page.slug),
      });
      expect(issue.isError).toBe(true);
      expect(wiki.isError).toBe(true);
      expect(await prisma.issue.count({ where: { projectId: ctx.projectId, number } })).toBe(1);
      expect(await prisma.page.count({ where: { id: page.id } })).toBe(1);
    });

    it('cross-org: a stranger reads nothing of an issue by id, by key or by search', async () => {
      const mark = `crossorg${Date.now()}`;
      const { number, key } = await createIssue(`Secret ${mark}`);
      const c = await asUser(await newUser());
      const byId = await callTool(c, 'act', {
        action: 'issue.get',
        input: { projectId: ctx.projectId, issueNumber: number },
      });
      const byKey = await callTool(c, 'read', { keys: [key] });
      const search = await callTool(c, 'search', { query: mark });
      expect(byId.isError).toBe(true);
      expect(byKey.data.items[0].error.status).toBe(404);
      for (const { text } of [byId, byKey, search]) expect(text).not.toContain(mark);
    });

    it('denies issue actions to an org member who is not on the project team', async () => {
      const { number } = await createIssue('Team only');
      const orgOnly = await newUser();
      await prisma.orgMembership.create({
        data: { orgId: ctx.orgId, userId: orgOnly.id, role: 'MEMBER' },
      });
      const c = await asUser(orgOnly);
      const issueIds = { projectId: ctx.projectId, issueNumber: number };
      const list = await callTool(c, 'act', {
        action: 'issue.list',
        input: { projectId: ctx.projectId },
      });
      const get = await callTool(c, 'act', { action: 'issue.get', input: issueIds });
      expect(list.isError).toBe(true);
      expect(get.isError).toBe(true);
      expect(get.text).not.toContain('Team only');

      const sprint = await prisma.sprint.create({
        data: {
          projectId: ctx.projectId,
          name: 'S1',
          startDate: new Date(),
          endDate: new Date(Date.now() + 86_400_000),
        },
      });
      const getSprint = await callTool(c, 'act', {
        action: 'sprint.get',
        input: { projectId: ctx.projectId, sprintId: sprint.id },
      });
      expect(getSprint.isError).toBe(true);

      // A team member still gets through
      const ok = await callTool(await asUser(await newMember()), 'act', {
        action: 'issue.get',
        input: issueIds,
      });
      expect(ok.isError).toBe(false);
      expect(ok.text).toContain('Team only');
    });

    it('does not reveal a VIEW-restricted page by action or by key', async () => {
      const slug = `secret-${Date.now()}`;
      const page = await createPage(slug, 'classified body');
      await prisma.pageRestriction.create({
        data: { pageId: page.id, type: 'VIEW', userId: ctx.owner.id },
      });
      const c = await asUser(await newMember());
      const get = await callTool(c, 'act', { action: 'page.get', input: slugPage(slug) });
      const read = await callTool(c, 'read', {
        keys: [`${ctx.orgSlug}/${ctx.teamSlug}/agent-space/${slug}`],
      });
      expect(get.isError).toBe(true);
      expect(read.data.items[0].error.status).toBe(404);
      for (const { text } of [get, read]) expect(text).not.toContain('classified body');
    });

    it('denies page.get in a space whose permissions leave the user out', async () => {
      const space = await prisma.wikiSpace.create({
        data: {
          teamId: ctx.teamId,
          name: 'Locked Space',
          slug: `rest-locked-${Date.now()}`,
          permissions: { create: { userId: ctx.owner.id, level: 'ADMIN' } },
        },
      });
      await createPage('locked', 'locked body', space.id);
      const res = await callTool(await asUser(await newMember()), 'act', {
        action: 'page.get',
        input: slugPage('locked', space.id),
      });
      expect(res.isError).toBe(true);
      expect(res.text).not.toContain('locked body');
    });

    it('team role wins: an org MEMBER whose team role is VIEWER reads but does not write', async () => {
      const teamViewer = await newMember();
      await prisma.teamMembership.update({
        where: { userId_teamId: { userId: teamViewer.id, teamId: ctx.teamId } },
        data: { role: 'VIEWER' },
      });
      const c = await asUser(teamViewer);
      const create = await callTool(c, 'act', {
        action: 'issue.create',
        input: { projectId: ctx.projectId, title: 'by a team viewer' },
      });
      const read = await callTool(c, 'act', {
        action: 'issue.list',
        input: { projectId: ctx.projectId },
      });
      expect([create.isError, read.isError]).toEqual([true, false]);
    });

    it('an explicit space grant works over MCP as it does over REST', async () => {
      const granted = await newMember();
      await prisma.orgMembership.update({
        where: { userId_orgId: { userId: granted.id, orgId: ctx.orgId } },
        data: { role: 'VIEWER' },
      });
      await prisma.teamMembership.deleteMany({ where: { userId: granted.id } });
      const space = await prisma.wikiSpace.create({
        data: {
          teamId: ctx.teamId,
          name: 'Granted',
          slug: `granted-${Date.now()}`,
          permissions: { create: { userId: granted.id, level: 'EDIT' } },
        },
      });
      await createPage('g', 'before', space.id);
      const res = await callTool(await asUser(granted), 'act', {
        action: 'page.update',
        input: { ...slugPage('g', space.id), body: 'after' },
      });
      expect(res.isError).toBe(false);
    });

    it('uiOnly and tokenBlocked stay closed over MCP with every scope, uiOnly on /api/act too', async () => {
      registerActions(
        (['test.mcpUiOnly', 'test.mcpTokenBlocked'] as const).map((name) =>
          defineAction({
            name,
            area: 'issues',
            kind: 'read',
            summary: name,
            input: z.object({}),
            output: z.looseObject({}),
            ...(name === 'test.mcpUiOnly' ? { uiOnly: true } : { tokenBlocked: true }),
            authorize: async () => {},
            handler: async () => ({ ran: true }),
          }),
        ),
      );
      const c = await client(await tokenHeader([...MINTABLE_SCOPES]));
      const { data } = await callTool(c, 'describe');
      const names = (data as Array<{ name: string }>).map((a) => a.name);
      expect(names).toContain('issue.get');
      for (const action of ['test.mcpUiOnly', 'test.mcpTokenBlocked']) {
        expect(names).not.toContain(action);
        expectRefused(await callTool(c, 'describe', { action }), 403, 'SCOPE');
        expectRefused(await callTool(c, 'act', { action }), 403, 'SCOPE');
      }

      // A session names actions on /api/act: uiOnly stays for its own routes, with their limiters,
      // while tokenBlocked is a normal action for a session
      const uiOnly = await authPost('/api/act', ctx.owner.token, { action: 'test.mcpUiOnly' });
      expect(uiOnly.status).toBe(403);
      const blocked = await authPost('/api/act', ctx.owner.token, {
        action: 'test.mcpTokenBlocked',
      });
      expect(blocked.status).toBe(200);
    });
  });
});
