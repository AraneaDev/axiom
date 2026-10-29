import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../config/database';
import {
  addMemberToContext,
  createTestContext,
  cleanupTestContext,
  type TestContext,
} from '../test/factory';

import { mcpContext } from './context';
import { createMcpServer } from './server';

describe('MCP server', () => {
  let tctx: TestContext;
  let client: Client;

  beforeAll(async () => {
    tctx = await createTestContext('mcp4');
    const server = createMcpServer(tctx.owner.id);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'test', version: '0.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  });

  afterAll(async () => {
    await client.close();
    await cleanupTestContext(tctx);
    await prisma.$disconnect();
  });

  it('tools/list returns exactly the 24 issue, wiki, org, search and integration tools', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toHaveLength(24);
    expect(names).not.toContain('list_repos');
    expect(names).not.toContain('create_pull_request');
    expect(names).not.toContain('trigger_pipeline');
  });

  it('MCP update_wiki_page enforces edit permission', async () => {
    const space = await prisma.wikiSpace.create({
      data: { teamId: tctx.teamId, name: 'MCP Space', slug: 'mcp-space' },
    });
    const page = await prisma.page.create({
      data: { spaceId: space.id, title: 'MCP page', slug: 'mcp-page', body: 'before' },
    });
    const viewer = await addMemberToContext(tctx, {
      email: 'mcp-viewer@axiom.dev',
      username: 'mcp-viewer',
    });
    await prisma.orgMembership.update({
      where: { userId_orgId: { userId: viewer.id, orgId: tctx.orgId } },
      data: { role: 'VIEWER' },
    });
    // Team MEMBER would grant wiki:edit on its own: a viewer has no team role
    await prisma.teamMembership.deleteMany({ where: { userId: viewer.id } });
    const server = createMcpServer(viewer.id);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const viewerClient = new Client({ name: 'viewer', version: '0.0.0' });
    await Promise.all([server.connect(serverTransport), viewerClient.connect(clientTransport)]);

    let failed = false;
    try {
      const res = await mcpContext.run({ userId: viewer.id }, () =>
        viewerClient.callTool({
          name: 'update_wiki_page',
          arguments: { spaceId: space.id, pageSlug: 'mcp-page', body: 'hacked' },
        }),
      );
      failed = res.isError === true;
    } catch {
      failed = true;
    }
    await viewerClient.close();
    expect(failed).toBe(true);
    const unchanged = await prisma.page.findUniqueOrThrow({ where: { id: page.id } });
    expect(unchanged.body).toBe('before');

    // The owner may update, and the write goes through the service as an EXTERNAL version
    const ok = await mcpContext.run({ userId: tctx.owner.id }, () =>
      client.callTool({
        name: 'update_wiki_page',
        arguments: { spaceId: space.id, pageSlug: 'mcp-page', body: 'after' },
      }),
    );
    expect(ok.isError).toBeFalsy();
    const versions = await prisma.pageVersion.findMany({ where: { pageId: page.id } });
    expect(versions.map((v) => v.kind)).toEqual(['EXTERNAL']);
    expect((await prisma.page.findUniqueOrThrow({ where: { id: page.id } })).body).toBe('after');
  });

  it('calling a removed tool returns an unknown-tool error', async () => {
    let message = '';
    try {
      const res = await client.callTool({ name: 'list_repos', arguments: {} });
      expect(res.isError).toBe(true);
      message = JSON.stringify(res.content);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message.toLowerCase()).toMatch(/not found|unknown/);
  });
});
