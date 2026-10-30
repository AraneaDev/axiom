/**
 * API token scopes are enforced: a read-scoped token can't write, a wiki token can't touch
 * issues, tokens can't manage orgs or mint tokens, and unknown scopes are refused.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../config/database';
import app from '../index';
import { mcpContext } from '../mcp/context';
import { createMcpServer } from '../mcp/server';
import { cleanupTestContext, createTestContext, type TestContext } from '../test/factory';
import { authPost } from '../test/helpers';

describe('API token scopes', () => {
  let ctx: TestContext;
  let spaceId: string;
  const tokens: Record<string, string> = {};

  const withToken = (
    scope: string,
    method: 'get' | 'post' | 'patch',
    path: string,
    body?: object,
  ) => {
    const agent = request(app);
    const base =
      method === 'get' ? agent.get(path) : method === 'post' ? agent.post(path) : agent.patch(path);
    const req = base
      .set('Authorization', `Token ${tokens[scope]}`)
      .set('X-Requested-With', 'XMLHttpRequest');
    return body ? req.send(body) : req;
  };

  beforeAll(async () => {
    ctx = await createTestContext(`scopes${Date.now()}`);
    spaceId = (
      await prisma.wikiSpace.create({ data: { teamId: ctx.teamId, name: 'S', slug: 'scopes' } })
    ).id;
    for (const scopes of [['issues:read'], ['issues:write'], ['wiki:read']]) {
      const res = await authPost('/api/users/me/tokens', ctx.owner.token, {
        name: scopes[0],
        scopes,
      });
      expect(res.status).toBe(201);
      tokens[scopes[0]] = res.body.token;
    }
  });

  afterAll(async () => {
    await cleanupTestContext(ctx);
  });

  it('refuses unknown scopes when a token is created', async () => {
    const res = await authPost('/api/users/me/tokens', ctx.owner.token, {
      name: 'bad',
      scopes: ['everything'],
    });
    expect(res.status).toBe(400);
  });

  it('lets each token do only what its scopes allow', async () => {
    const P = `/api/projects/${ctx.projectId}`;
    const results = {
      readList: (await withToken('issues:read', 'get', `${P}/issues`)).status,
      readCreate: (await withToken('issues:read', 'post', `${P}/issues`, { title: 'x' })).status,
      writeCreate: (await withToken('issues:write', 'post', `${P}/issues`, { title: 'x' })).status,
      wikiOnIssues: (await withToken('wiki:read', 'get', `${P}/issues`)).status,
      wikiRead: (await withToken('wiki:read', 'get', `/api/wiki/spaces/${spaceId}/tree`)).status,
      wikiWrite: (
        await withToken('wiki:read', 'post', `/api/wiki/spaces/${spaceId}/pages`, {
          title: 'x',
          slug: 'x',
        })
      ).status,
      orgWrite: (await withToken('issues:write', 'patch', `/api/orgs/${ctx.orgId}`, { name: 'x' }))
        .status,
      mintToken: (
        await withToken('issues:write', 'post', '/api/users/me/tokens', {
          name: 'more',
          scopes: ['issues:write'],
        })
      ).status,
    };
    expect(results).toEqual({
      readList: 200,
      readCreate: 403,
      writeCreate: 201,
      wikiOnIssues: 403,
      wikiRead: 200,
      wikiWrite: 403,
      orgWrite: 403,
      mintToken: 403,
    });
  });

  it('applies scopes to MCP tools', async () => {
    const server = createMcpServer(ctx.owner.id);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'scoped', version: '0.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const run = (name: string, args: Record<string, unknown>) =>
      mcpContext.run({ userId: ctx.owner.id, scopes: ['issues:read'] }, async () => {
        try {
          const res = await client.callTool({ name, arguments: args });
          return res.isError === true ? 'denied' : 'ok';
        } catch {
          return 'denied';
        }
      });
    const list = await run('list_issues', { projectId: ctx.projectId });
    const create = await run('create_issue', { projectId: ctx.projectId, title: 'via mcp' });
    await client.close();
    expect([list, create]).toEqual(['ok', 'denied']);
  });
});
