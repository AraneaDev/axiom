import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../config/database';
import { createTestContext, cleanupTestContext, type TestContext } from '../test/factory';

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
