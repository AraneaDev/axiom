/**
 * Page listings (tree, space, children) leave out pages a VIEW restriction hides.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../../config/database';
import { mcpContext } from '../../mcp/context';
import { createMcpServer } from '../../mcp/server';
import {
  addMemberToContext,
  cleanupTestContext,
  createTestContext,
  type TestContext,
  type TestUser,
} from '../../test/factory';
import { authDel, authGet, authPatch, authPost, authPut } from '../../test/helpers';

describe('Hidden pages in listings', () => {
  let ctx: TestContext;
  let member: TestUser;
  let spaceId: string;
  const SECRET = `Secret-${Date.now()}`;

  beforeAll(async () => {
    ctx = await createTestContext(`wikivis${Date.now()}`);
    member = await addMemberToContext(ctx);
    const space = await prisma.wikiSpace.create({
      data: { teamId: ctx.teamId, name: 'Vis', slug: 'vis' },
    });
    spaceId = space.id;
    const parent = await prisma.page.create({
      data: { spaceId, title: 'Parent', slug: 'parent', body: 'p' },
    });
    const rootSecret = await prisma.page.create({
      data: { spaceId, title: `${SECRET} root`, slug: 'secret-root', body: 's' },
    });
    const childSecret = await prisma.page.create({
      data: {
        spaceId,
        parentId: parent.id,
        title: `${SECRET} child`,
        slug: 'secret-child',
        body: 's',
      },
    });
    for (const id of [rootSecret.id, childSecret.id]) {
      await prisma.pageRestriction.create({
        data: { pageId: id, type: 'VIEW', userId: ctx.owner.id },
      });
    }
  });

  afterAll(async () => {
    await cleanupTestContext(ctx);
    await prisma.user.deleteMany({ where: { id: member.id } });
  });

  it('leaves hidden pages out of the tree, the space and the parent page', async () => {
    for (const path of [
      `/api/wiki/spaces/${spaceId}/tree`,
      `/api/wiki/spaces/${spaceId}`,
      `/api/wiki/spaces/${spaceId}/pages/parent`,
    ]) {
      const res = await authGet(path, member.token);
      expect(res.status).toBe(200);
      expect(JSON.stringify(res.body)).not.toContain(SECRET);
    }
    // The owner, on the allow-list, still sees them
    const ownerTree = await authGet(`/api/wiki/spaces/${spaceId}/tree`, ctx.owner.token);
    expect(JSON.stringify(ownerTree.body)).toContain(`${SECRET} child`);
  });

  it('leaves hidden pages out of the MCP page tree', async () => {
    const server = createMcpServer(member.id);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'vis', version: '0.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const res = await mcpContext.run({ userId: member.id }, () =>
      client.callTool({ name: 'get_page_tree', arguments: { spaceId } }),
    );
    await client.close();
    expect(res.isError).toBeFalsy();
    expect(JSON.stringify(res.content)).not.toContain(SECRET);
  });

  it('refuses every page route on a hidden page to a member it hides it from', async () => {
    const page = await prisma.page.findFirstOrThrow({ where: { spaceId, slug: 'secret-root' } });
    await prisma.pageComment.create({
      data: { pageId: page.id, userId: ctx.owner.id, body: `${SECRET} comment` },
    });
    const restriction = await prisma.pageRestriction.findFirstOrThrow({
      where: { pageId: page.id },
    });
    const base = `/api/wiki/spaces/${spaceId}/pages/secret-root`;
    const calls = [
      authGet(base, member.token),
      authGet(`${base}/hydrate`, member.token),
      authGet(`${base}/history`, member.token),
      authGet(`${base}/export?format=html`, member.token),
      authGet(`/api/wiki/pages/${page.id}/comments`, member.token),
      authGet(`/api/wiki/pages/${page.id}/labels`, member.token),
      authGet(`/api/wiki/pages/${page.id}/restrictions`, member.token),
      authGet(`/api/wiki/pages/${page.id}/linked-issues`, member.token),
      authPut(`/api/wiki/pages/${page.id}/restrictions`, member.token, {
        type: 'VIEW',
        userIds: [member.id],
      }),
      authDel(`/api/wiki/restrictions/${restriction.id}`, member.token),
      authPost(`/api/wiki/pages/${page.id}/move`, member.token, { parentId: null }),
      authPost(`/api/wiki/pages/${page.id}/copy`, member.token, {}),
      authPatch(`/api/wiki/pages/${page.id}/reorder`, member.token, {
        parentId: null,
        position: 0,
      }),
    ];
    const results = await Promise.all(calls);
    const leaks = results
      .map((r, i) => ({ i, status: r.status, body: JSON.stringify(r.body ?? r.text) }))
      .filter((r) => r.status !== 403 || r.body.includes(SECRET));
    expect(leaks).toEqual([]);
    // The restriction is untouched
    expect(await prisma.pageRestriction.count({ where: { pageId: page.id } })).toBe(1);
  });

  it('refuses page routes in a space whose permissions leave the member out', async () => {
    const locked = await prisma.wikiSpace.create({
      data: {
        teamId: ctx.teamId,
        name: 'Locked',
        slug: 'vis-locked',
        permissions: { create: { userId: ctx.owner.id, level: 'ADMIN' } },
      },
    });
    const page = await prisma.page.create({
      data: { spaceId: locked.id, title: 'L', slug: 'l', body: 'x' },
    });
    const comment = await prisma.pageComment.create({
      data: { pageId: page.id, userId: ctx.owner.id, body: 'c' },
    });
    const results = await Promise.all([
      authGet(`/api/wiki/pages/${page.id}/comments`, member.token),
      authPost(`/api/wiki/pages/${page.id}/comments`, member.token, { body: 'x' }),
      authPost(`/api/wiki/comments/${comment.id}/reactions`, member.token, {
        reactionType: 'THUMBS_UP',
      }),
      authPost(`/api/wiki/pages/${page.id}/labels`, member.token, { label: 'x' }),
    ]);
    expect(results.map((r) => r.status)).toEqual([403, 403, 403, 403]);
  });

  it('refuses to move or copy a page into another org', async () => {
    const other = await createTestContext(`wikivisother${Date.now()}`);
    try {
      const foreign = await prisma.wikiSpace.create({
        data: { teamId: other.teamId, name: 'Foreign', slug: 'foreign' },
      });
      const parent = await prisma.page.findFirstOrThrow({ where: { spaceId, slug: 'parent' } });
      const copy = await authPost(`/api/wiki/pages/${parent.id}/copy`, member.token, {
        targetSpaceId: foreign.id,
      });
      const move = await authPost(`/api/wiki/pages/${parent.id}/move`, member.token, {
        targetSpaceId: foreign.id,
      });
      expect([copy.status, move.status]).toEqual([403, 403]);
      expect(await prisma.page.count({ where: { spaceId: foreign.id } })).toBe(0);
    } finally {
      await cleanupTestContext(other);
    }
  });
});
