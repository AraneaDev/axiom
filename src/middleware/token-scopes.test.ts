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

import { LEGACY_SCOPE_MAP } from './token-scopes';

describe('API token scopes', () => {
  let ctx: TestContext;
  let spaceId: string;
  const tokens: Record<string, string> = {};

  const withToken = (
    scope: string,
    method: 'get' | 'post' | 'patch' | 'put' | 'delete',
    path: string,
    body?: object,
  ) => {
    const agent = request(app);
    const base =
      method === 'get'
        ? agent.get(path)
        : method === 'post'
          ? agent.post(path)
          : method === 'put'
            ? agent.put(path)
            : method === 'delete'
              ? agent.delete(path)
              : agent.patch(path);
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
    // Tokens as stored since scopes per area, so each case still meets the rule it names
    for (const legacy of ['issues:read', 'issues:write', 'wiki:read', 'wiki:write'] as const) {
      const res = await authPost('/api/users/me/tokens', ctx.owner.token, {
        name: legacy,
        scopes: LEGACY_SCOPE_MAP[legacy],
      });
      expect(res.status).toBe(201);
      tokens[legacy] = res.body.token;
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
    expect([list, create]).toEqual(['ok', 'denied']);

    // A wiki-only token's MCP search returns no issues, an issues token's does
    const term = `scopedsearch${Date.now()}`;
    await prisma.issue.create({
      data: {
        projectId: ctx.projectId,
        number: 950,
        title: term,
        body: '',
        creatorId: ctx.owner.id,
      },
    });
    const searchAs = async (scopes: string[]) => {
      const res = await mcpContext.run({ userId: ctx.owner.id, scopes }, () =>
        client.callTool({ name: 'search', arguments: { query: term, type: 'all' } }),
      );
      const text = (res.content as Array<{ text: string }>)[0].text;
      return (JSON.parse(text) as Array<{ type: string }>).map((r) => r.type);
    };
    const wikiTypes = await searchAs(['wiki:read']);
    const issueTypes = await searchAs(['issues:read']);
    await client.close();
    expect(wikiTypes).toEqual([]);
    expect(issueTypes).toEqual(['issue']);
  });

  it('8, 12, 13, 14: scopes follow the resource, and tokens never change access control', async () => {
    const issue = await prisma.issue.create({
      data: {
        projectId: ctx.projectId,
        number: 900,
        title: `ScopeIssue${Date.now()}`,
        body: '',
        creatorId: ctx.owner.id,
      },
    });
    const page = await prisma.page.create({
      data: { spaceId, title: 'Scoped', slug: `scoped-${Date.now()}`, body: 'x' },
    });
    const issueAttachment = await prisma.attachment.create({
      data: {
        filename: 'a.txt',
        originalName: 'a.txt',
        mimeType: 'text/plain',
        size: 1,
        storageKey: `missing-${Date.now()}`,
        uploaderId: ctx.owner.id,
        issueId: issue.id,
      },
    });
    const upload = await request(app)
      .post('/api/attachments')
      .set('Authorization', `Token ${tokens['wiki:write']}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .field('issueId', issue.id)
      .attach('file', Buffer.from('x'), 'x.txt');
    const results = {
      wikiTokenUploadsToIssue: upload.status,
      wikiTokenReadsIssueAttachment: (
        await withToken('wiki:read', 'get', `/api/attachments/${issueAttachment.id}/meta`)
      ).status,
      wikiTokenListsIssueAttachments: (
        await withToken('wiki:read', 'get', `/api/attachments?issueId=${issue.id}`)
      ).status,
      wikiTokenDashboard: (await withToken('wiki:read', 'get', '/api/users/me/dashboard')).status,
      wikiTokenTeamActivity: (
        await withToken('wiki:read', 'get', `/api/teams/${ctx.teamId}/activity`)
      ).status,
      spacePermissions: (
        await withToken('wiki:write', 'put', `/api/wiki/spaces/${spaceId}/permissions`, {
          userId: ctx.owner.id,
          level: 'ADMIN',
        })
      ).status,
      pageRestrictions: (
        await withToken('wiki:write', 'put', `/api/wiki/pages/${page.id}/restrictions`, {
          type: 'VIEW',
          userIds: [ctx.owner.id],
        })
      ).status,
      deleteProject: (await withToken('issues:write', 'delete', `/api/projects/${ctx.projectId}`))
        .status,
      createProject: (
        await withToken('issues:write', 'post', `/api/projects/team/${ctx.teamId}`, {
          name: 'Tok',
          slug: `tok-${Date.now()}`,
          prefix: 'TOK',
        })
      ).status,
      teamsRoadmapWrite: (await withToken('issues:write', 'patch', '/api/teams/roadmap', {}))
        .status,
    };
    expect(results).toEqual({
      wikiTokenUploadsToIssue: 403,
      wikiTokenReadsIssueAttachment: 403,
      wikiTokenListsIssueAttachments: 403,
      wikiTokenDashboard: 403,
      wikiTokenTeamActivity: 403,
      spacePermissions: 403,
      pageRestrictions: 403,
      deleteProject: 403,
      createProject: 403,
      teamsRoadmapWrite: 403,
    });

    // A wiki token's search has no issues in it
    const search = await withToken('wiki:read', 'get', `/api/search?q=${issue.title}&type=all`);
    expect(search.status).toBe(200);
    expect(JSON.stringify(search.body)).not.toContain(issue.title);
  });

  it('N2: the same rules over HTTP for trailing-slash and upper-case spellings', async () => {
    const results = {
      deleteProject: (await withToken('issues:write', 'delete', `/api/projects/${ctx.projectId}/`))
        .status,
      spacePermissions: (
        await withToken('wiki:write', 'put', `/api/wiki/spaces/${spaceId}/PERMISSIONS`, {
          userId: ctx.owner.id,
          level: 'ADMIN',
        })
      ).status,
      activity: (await withToken('wiki:read', 'get', `/api/teams/${ctx.teamId}/activity/`)).status,
      dashboard: (await withToken('wiki:read', 'get', '/api/users/me/dashboard/')).status,
    };
    expect(results).toEqual({
      deleteProject: 403,
      spacePermissions: 403,
      activity: 403,
      dashboard: 403,
    });
    expect(await prisma.project.count({ where: { id: ctx.projectId } })).toBe(1);
  });
});
