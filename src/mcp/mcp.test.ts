import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../config/database';
import {
  addMemberToContext,
  createTestContext,
  createTestUser,
  cleanupTestContext,
  type TestContext,
  type TestUser,
} from '../test/factory';

import { mcpContext } from './context';
import { assertMcpPermission, MCP_TOOL_PERMISSIONS } from './mcp-permissions';
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

    // The owner may update. With no live session the write is a plain EDIT version
    const ok = await mcpContext.run({ userId: tctx.owner.id }, () =>
      client.callTool({
        name: 'update_wiki_page',
        arguments: { spaceId: space.id, pageSlug: 'mcp-page', body: 'after' },
      }),
    );
    expect(ok.isError).toBeFalsy();
    const versions = await prisma.pageVersion.findMany({ where: { pageId: page.id } });
    expect(versions.map((v) => v.kind)).toEqual(['EDIT']);
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

  it('MCP page writes require EDIT access to the space', async () => {
    const space = await prisma.wikiSpace.create({
      data: { teamId: tctx.teamId, name: 'MCP Locked Space', slug: 'mcp-locked-space' },
    });
    const page = await prisma.page.create({
      data: { spaceId: space.id, title: 'Locked page', slug: 'locked-page', body: 'before' },
    });
    // A team member, so the org and page checks pass, who may only view this space
    const reader = await addMemberToContext(tctx, {
      email: 'mcp-space-reader@axiom.dev',
      username: 'mcp-space-reader',
    });
    await prisma.spacePermission.create({
      data: { spaceId: space.id, userId: reader.id, level: 'VIEW' },
    });
    const server = createMcpServer(reader.id);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const readerClient = new Client({ name: 'reader', version: '0.0.0' });
    await Promise.all([server.connect(serverTransport), readerClient.connect(clientTransport)]);

    const call = async (name: string, args: Record<string, unknown>) => {
      try {
        const res = await mcpContext.run({ userId: reader.id }, () =>
          readerClient.callTool({ name, arguments: args }),
        );
        return { failed: res.isError === true, text: JSON.stringify(res.content) };
      } catch (err) {
        return { failed: true, text: (err as Error).message };
      }
    };

    const update = await call('update_wiki_page', {
      spaceId: space.id,
      pageSlug: 'locked-page',
      body: 'changed by a reader',
    });
    const create = await call('create_wiki_page', {
      spaceId: space.id,
      title: 'Sneaky',
      slug: 'sneaky',
      body: 'x',
    });
    await readerClient.close();

    expect(update.failed).toBe(true);
    expect(create.failed).toBe(true);
    expect((await prisma.page.findUniqueOrThrow({ where: { id: page.id } })).body).toBe('before');
    expect(await prisma.page.count({ where: { spaceId: space.id, slug: 'sneaky' } })).toBe(0);
  });
});

describe('MCP permission mapping', () => {
  let tctx: TestContext;
  let stranger: TestUser;
  let strangerClient: Client;

  const callAs = async (
    userId: string,
    c: Client,
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ failed: boolean; text: string }> => {
    try {
      const res = await mcpContext.run({ userId }, () => c.callTool({ name, arguments: args }));
      return { failed: res.isError === true, text: JSON.stringify(res.content) };
    } catch (err) {
      return { failed: true, text: (err as Error).message };
    }
  };

  beforeAll(async () => {
    tctx = await createTestContext('mcpmap');
    // A user of a different org, with full rights there
    stranger = await createTestUser();
    const server = createMcpServer(stranger.id);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    strangerClient = new Client({ name: 'stranger', version: '0.0.0' });
    await Promise.all([server.connect(serverTransport), strangerClient.connect(clientTransport)]);
  });

  afterAll(async () => {
    await strangerClient.close();
    await cleanupTestContext(tctx);
    await prisma.user.deleteMany({ where: { id: stranger.id } });
  });

  it('maps every registered tool to a permission', async () => {
    const { tools } = await strangerClient.listTools();
    const unmapped = tools.map((t) => t.name).filter((n) => !(n in MCP_TOOL_PERMISSIONS));
    expect(unmapped).toEqual([]);
  });

  it('refuses a tool with no permission mapping', async () => {
    await expect(
      mcpContext.run({ userId: tctx.owner.id }, () =>
        assertMcpPermission('not_a_mapped_tool', tctx.orgId),
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('denies delete_issue on a project in another org', async () => {
    const issue = await prisma.issue.create({
      data: {
        projectId: tctx.projectId,
        number: 1,
        title: 'Keep me',
        body: '',
        creatorId: tctx.owner.id,
      },
    });
    const res = await callAs(stranger.id, strangerClient, 'delete_issue', {
      projectId: tctx.projectId,
      issueNumber: 1,
    });
    expect(res.failed).toBe(true);
    expect(await prisma.issue.count({ where: { id: issue.id } })).toBe(1);
  });

  it('denies delete_wiki_page in another org', async () => {
    const space = await prisma.wikiSpace.create({
      data: { teamId: tctx.teamId, name: 'Map Space', slug: 'map-space' },
    });
    const page = await prisma.page.create({
      data: { spaceId: space.id, title: 'Keep me', slug: 'keep-me', body: 'x' },
    });
    const res = await callAs(stranger.id, strangerClient, 'delete_wiki_page', {
      spaceId: space.id,
      pageSlug: 'keep-me',
    });
    expect(res.failed).toBe(true);
    expect(await prisma.page.count({ where: { id: page.id } })).toBe(1);
  });
});

describe('MCP checks match REST', () => {
  let tctx: TestContext;
  let orgOnly: TestUser;
  let orgOnlyClient: Client;
  let member: TestUser;
  let memberClient: Client;

  const connectAs = async (userId: string) => {
    const server = createMcpServer(userId);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const c = new Client({ name: userId, version: '0.0.0' });
    await Promise.all([server.connect(serverTransport), c.connect(clientTransport)]);
    return c;
  };

  const callAs = async (userId: string, c: Client, name: string, args: Record<string, unknown>) => {
    try {
      const res = await mcpContext.run({ userId }, () => c.callTool({ name, arguments: args }));
      return { failed: res.isError === true, text: JSON.stringify(res.content) };
    } catch (err) {
      return { failed: true, text: (err as Error).message };
    }
  };

  beforeAll(async () => {
    tctx = await createTestContext('mcprest');
    member = await addMemberToContext(tctx);
    // In the org, but not on the team that owns the project
    orgOnly = await createTestUser();
    await prisma.orgMembership.create({
      data: { orgId: tctx.orgId, userId: orgOnly.id, role: 'MEMBER' },
    });
    orgOnlyClient = await connectAs(orgOnly.id);
    memberClient = await connectAs(member.id);
    await prisma.issue.create({
      data: {
        projectId: tctx.projectId,
        number: 1,
        title: 'Team only',
        body: '',
        creatorId: tctx.owner.id,
      },
    });
  });

  afterAll(async () => {
    await orgOnlyClient.close();
    await memberClient.close();
    await cleanupTestContext(tctx);
    await prisma.user.deleteMany({ where: { id: { in: [orgOnly.id, member.id] } } });
  });

  it('denies issue tools to an org member who is not on the project team', async () => {
    const list = await callAs(orgOnly.id, orgOnlyClient, 'list_issues', {
      projectId: tctx.projectId,
    });
    const get = await callAs(orgOnly.id, orgOnlyClient, 'get_issue', {
      projectId: tctx.projectId,
      issueNumber: 1,
    });
    expect(list.failed).toBe(true);
    expect(get.failed).toBe(true);
    expect(get.text).not.toContain('Team only');

    const sprint = await prisma.sprint.create({
      data: {
        projectId: tctx.projectId,
        name: 'S1',
        startDate: new Date(),
        endDate: new Date(Date.now() + 86_400_000),
      },
    });
    const getSprint = await callAs(orgOnly.id, orgOnlyClient, 'get_sprint', {
      sprintId: sprint.id,
    });
    expect(getSprint.failed).toBe(true);

    // A team member still gets through
    const ok = await callAs(member.id, memberClient, 'get_issue', {
      projectId: tctx.projectId,
      issueNumber: 1,
    });
    expect(ok.failed).toBe(false);
    expect(ok.text).toContain('Team only');
  });

  it('does not reveal a VIEW-restricted page through get_wiki_page', async () => {
    const space = await prisma.wikiSpace.create({
      data: { teamId: tctx.teamId, name: 'Rest Space', slug: 'rest-space' },
    });
    const page = await prisma.page.create({
      data: { spaceId: space.id, title: 'Secret', slug: 'secret', body: 'classified body' },
    });
    await prisma.pageRestriction.create({
      data: { pageId: page.id, type: 'VIEW', userId: tctx.owner.id },
    });
    const res = await callAs(member.id, memberClient, 'get_wiki_page', {
      spaceId: space.id,
      pageSlug: 'secret',
    });
    expect(res.failed).toBe(true);
    expect(res.text).not.toContain('classified body');
  });

  it('denies get_wiki_page in a space whose permissions leave the user out', async () => {
    const space = await prisma.wikiSpace.create({
      data: {
        teamId: tctx.teamId,
        name: 'Locked Space',
        slug: 'rest-locked-space',
        permissions: { create: { userId: tctx.owner.id, level: 'ADMIN' } },
      },
    });
    await prisma.page.create({
      data: { spaceId: space.id, title: 'Locked', slug: 'locked', body: 'locked body' },
    });
    const res = await callAs(member.id, memberClient, 'get_wiki_page', {
      spaceId: space.id,
      pageSlug: 'locked',
    });
    expect(res.failed).toBe(true);
    expect(res.text).not.toContain('locked body');
  });

  it('denies MCP writes to an org MEMBER whose team role is VIEWER', async () => {
    const teamViewer = await addMemberToContext(tctx);
    await prisma.teamMembership.update({
      where: { userId_teamId: { userId: teamViewer.id, teamId: tctx.teamId } },
      data: { role: 'VIEWER' },
    });
    const c = await connectAs(teamViewer.id);
    try {
      const create = await callAs(teamViewer.id, c, 'create_issue', {
        projectId: tctx.projectId,
        title: 'by a team viewer',
      });
      const read = await callAs(teamViewer.id, c, 'list_issues', { projectId: tctx.projectId });
      expect([create.failed, read.failed]).toEqual([true, false]);
    } finally {
      await c.close();
      await prisma.user.deleteMany({ where: { id: teamViewer.id } });
    }
  });

  it('25: an explicit space grant works over MCP as it does over REST', async () => {
    const granted = await addMemberToContext(tctx);
    await prisma.orgMembership.update({
      where: { userId_orgId: { userId: granted.id, orgId: tctx.orgId } },
      data: { role: 'VIEWER' },
    });
    await prisma.teamMembership.deleteMany({ where: { userId: granted.id } });
    const space = await prisma.wikiSpace.create({
      data: {
        teamId: tctx.teamId,
        name: 'Granted',
        slug: `granted-${Date.now()}`,
        permissions: { create: { userId: granted.id, level: 'EDIT' } },
      },
    });
    await prisma.page.create({
      data: { spaceId: space.id, title: 'G', slug: 'g', body: 'before' },
    });
    const c = await connectAs(granted.id);
    try {
      const res = await callAs(granted.id, c, 'update_wiki_page', {
        spaceId: space.id,
        pageSlug: 'g',
        body: 'after',
      });
      expect(res.failed).toBe(false);
    } finally {
      await c.close();
      await prisma.wikiSpace.delete({ where: { id: space.id } });
      await prisma.user.deleteMany({ where: { id: granted.id } });
    }
  });
});
