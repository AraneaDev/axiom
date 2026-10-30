/**
 * Search returns only what the searcher could open through the REST routes.
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
  createTestUser,
  type TestContext,
  type TestUser,
} from '../../test/factory';
import { authGet } from '../../test/helpers';

describe('Search access', () => {
  const MARK = `zebrafinch${Date.now()}`;
  let ctx: TestContext;
  let member: TestUser;
  let orgOnly: TestUser;
  let noOrg: TestUser;
  let lockedSpaceId: string;

  const restSearch = async (user: TestUser) => {
    const res = await authGet(`/api/search?q=${MARK}&type=all`, user.token);
    expect(res.status).toBe(200);
    return JSON.stringify(res.body);
  };

  const mcpSearch = async (user: TestUser) => {
    const server = createMcpServer(user.id);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'search', version: '0.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const res = await mcpContext.run({ userId: user.id }, () =>
      client.callTool({ name: 'search', arguments: { query: MARK, type: 'all' } }),
    );
    await client.close();
    return JSON.stringify(res.content);
  };

  beforeAll(async () => {
    ctx = await createTestContext(`srchacc${Date.now()}`);
    member = await addMemberToContext(ctx);
    orgOnly = await createTestUser();
    await prisma.orgMembership.create({
      data: { orgId: ctx.orgId, userId: orgOnly.id, role: 'MEMBER' },
    });
    noOrg = await createTestUser();

    await prisma.issue.create({
      data: {
        projectId: ctx.projectId,
        number: 1,
        title: `Issue ${MARK} team-only`,
        body: '',
        creatorId: ctx.owner.id,
      },
    });
    const openSpace = await prisma.wikiSpace.create({
      data: { teamId: ctx.teamId, name: 'Open', slug: 'search-open' },
    });
    await prisma.page.create({
      data: { spaceId: openSpace.id, title: `Open ${MARK}`, slug: 'open', body: MARK },
    });
    const hidden = await prisma.page.create({
      data: { spaceId: openSpace.id, title: `Hidden ${MARK}`, slug: 'hidden', body: MARK },
    });
    await prisma.pageRestriction.create({
      data: { pageId: hidden.id, type: 'VIEW', userId: ctx.owner.id },
    });
    const locked = await prisma.wikiSpace.create({
      data: {
        teamId: ctx.teamId,
        name: `LockedSpace ${MARK}`,
        slug: 'search-locked',
        permissions: { create: { userId: ctx.owner.id, level: 'ADMIN' } },
      },
    });
    lockedSpaceId = locked.id;
    await prisma.page.create({
      data: { spaceId: locked.id, title: `Locked ${MARK}`, slug: 'locked', body: MARK },
    });
  });

  afterAll(async () => {
    await cleanupTestContext(ctx);
    await prisma.user.deleteMany({ where: { id: { in: [member.id, orgOnly.id, noOrg.id] } } });
  });

  it('gives a user with no org nothing from other orgs', async () => {
    for (const text of [await restSearch(noOrg), await mcpSearch(noOrg)]) {
      expect(text).not.toContain(MARK);
    }
  });

  it("hides issues of projects whose team the searcher isn't on", async () => {
    for (const text of [await restSearch(orgOnly), await mcpSearch(orgOnly)]) {
      expect(text).not.toContain('team-only');
    }
    expect(await restSearch(member)).toContain('team-only');
  });

  it('hides VIEW-restricted pages and spaces the searcher may not view', async () => {
    for (const text of [await restSearch(member), await mcpSearch(member)]) {
      expect(text).toContain(`Open ${MARK}`);
      expect(text).not.toContain(`Hidden ${MARK}`);
      expect(text).not.toContain(`Locked ${MARK}`);
    }
    const owner = await restSearch(ctx.owner);
    expect(owner).toContain(`Hidden ${MARK}`);
  });

  it('lists only spaces the user may view in the search filter', async () => {
    const res = await authGet('/api/search/spaces', member.token);
    expect(res.status).toBe(200);
    expect(res.body.map((s: { id: string }) => s.id)).not.toContain(lockedSpaceId);
  });
});
