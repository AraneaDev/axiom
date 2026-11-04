/**
 * Search returns only what the searcher could open through the REST routes.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../../config/database';
import {
  addMemberToContext,
  cleanupTestContext,
  createTestContext,
  createTestUser,
  type TestContext,
  type TestUser,
} from '../../test/factory';
import { authGet } from '../../test/helpers';
import { callTool, withMcpClient } from '../../test/mcp-client';

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

  const mcpSearch = async (user: TestUser) =>
    withMcpClient(user, async (client) => {
      const res = await callTool(client, 'search', { query: MARK, type: 'all' });
      expect(res.isError).toBe(false);
      return res.text;
    });

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

  it('F: finds the searcher’s matches even when other orgs have many better-ranked ones', async () => {
    const other = await createTestContext(`srchflood${Date.now()}`);
    const TERM = `kestrel${Date.now()}`;
    try {
      await prisma.issue.createMany({
        data: Array.from({ length: 80 }, (_, i) => ({
          projectId: other.projectId,
          number: i + 1,
          title: `${TERM} ${TERM} ${TERM}`,
          body: `${TERM} ${TERM}`,
          creatorId: other.owner.id,
        })),
      });
      const space = await prisma.wikiSpace.create({
        data: { teamId: other.teamId, name: 'Flood', slug: 'flood' },
      });
      await prisma.page.createMany({
        data: Array.from({ length: 80 }, (_, i) => ({
          spaceId: space.id,
          title: `${TERM} ${TERM} ${TERM}`,
          slug: `flood-${i}`,
          body: `${TERM} ${TERM}`,
        })),
      });
      await prisma.issue.create({
        data: {
          projectId: ctx.projectId,
          number: 50,
          title: `Mine ${TERM}`,
          body: '',
          creatorId: ctx.owner.id,
        },
      });
      const ownSpace = await prisma.wikiSpace.findFirstOrThrow({ where: { slug: 'search-open' } });
      await prisma.page.create({
        data: { spaceId: ownSpace.id, title: `My page ${TERM}`, slug: 'mine', body: TERM },
      });
      const res = await authGet(`/api/search?q=${TERM}&type=all`, member.token);
      const text = JSON.stringify(res.body);
      expect(text).toContain(`Mine ${TERM}`);
      expect(text).toContain(`My page ${TERM}`);
    } finally {
      await cleanupTestContext(other);
    }
  });

  it('F: an empty query with no filters returns nothing', async () => {
    // Punctuation only: no free text and no structured filter
    const res = await authGet('/api/search?q=%21%21%21&type=issues', member.token);
    expect(res.status).toBe(200);
    const issues = (res.body as Array<{ type: string; items: unknown[] }>).find(
      (s) => s.type === 'issues',
    );
    expect(issues?.items ?? []).toEqual([]);
  });
});
