/**
 * Page listings (tree, space, children) leave out pages a VIEW restriction hides.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../../config/database';
import {
  addMemberToContext,
  cleanupTestContext,
  createTestContext,
  type TestContext,
  type TestUser,
} from '../../test/factory';
import { authDel, authGet, authPatch, authPost, authPut } from '../../test/helpers';
import { callTool, withMcpClient } from '../../test/mcp-client';

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
    const res = await withMcpClient(member, (client) =>
      callTool(client, 'act', { action: 'page.tree', input: { spaceId } }),
    );
    expect(res.isError).toBe(false);
    expect(res.text).not.toContain(SECRET);
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

  it('refuses a new page under a parent in another space or one the author may not edit', async () => {
    const other = await createTestContext(`wikivispar${Date.now()}`);
    try {
      const foreignSpace = await prisma.wikiSpace.create({
        data: { teamId: other.teamId, name: 'FP', slug: 'fp' },
      });
      const foreignParent = await prisma.page.create({
        data: { spaceId: foreignSpace.id, title: 'FP', slug: 'fp', body: 'x' },
      });
      const hiddenParent = await prisma.page.findFirstOrThrow({
        where: { spaceId, slug: 'secret-root' },
      });
      const foreign = await authPost(`/api/wiki/spaces/${spaceId}/pages`, member.token, {
        title: 'Child',
        slug: 'child-of-foreign',
        parentId: foreignParent.id,
      });
      const hidden = await authPost(`/api/wiki/spaces/${spaceId}/pages`, member.token, {
        title: 'Child',
        slug: 'child-of-hidden',
        parentId: hiddenParent.id,
      });
      const reparent = await authPatch(`/api/wiki/spaces/${spaceId}/pages/parent`, member.token, {
        parentId: foreignParent.id,
      });
      expect([foreign.status, hidden.status, reparent.status]).toEqual([400, 403, 400]);
      expect(
        await prisma.page.count({
          where: { slug: { in: ['child-of-foreign', 'child-of-hidden'] } },
        }),
      ).toBe(0);
    } finally {
      await cleanupTestContext(other);
    }
  });

  it("refuses MCP page.create from another org's template", async () => {
    const other = await createTestContext(`wikivistpl${Date.now()}`);
    try {
      const foreignSpace = await prisma.wikiSpace.create({
        data: { teamId: other.teamId, name: 'FT', slug: 'ft' },
      });
      const template = await prisma.pageTemplate.create({
        data: { spaceId: foreignSpace.id, name: 'T', body: `${SECRET} template body` },
      });
      const res = await withMcpClient(member, (client) =>
        callTool(client, 'act', {
          action: 'page.create',
          input: { spaceId, title: 'From tpl', slug: 'from-tpl', templateId: template.id },
        }),
      );
      expect(res.isError).toBe(true);
      expect(res.text).not.toContain(SECRET);
      expect(await prisma.page.count({ where: { spaceId, slug: 'from-tpl' } })).toBe(0);
    } finally {
      await cleanupTestContext(other);
    }
  });

  it('E, Z: label search, space lists and starred pages leave out what the user cannot view', async () => {
    const hidden = await prisma.page.findFirstOrThrow({ where: { spaceId, slug: 'secret-root' } });
    await prisma.pageLabel.create({ data: { pageId: hidden.id, label: 'vislabel' } });
    await prisma.starredPage.create({ data: { userId: member.id, pageId: hidden.id } });
    const locked = await prisma.wikiSpace.create({
      data: {
        teamId: ctx.teamId,
        name: `${SECRET} locked space`,
        slug: 'vis-locked-list',
        permissions: { create: { userId: ctx.owner.id, level: 'ADMIN' } },
      },
    });

    const labels = await authGet(`/api/wiki/spaces/${spaceId}/labels?label=vislabel`, member.token);
    const spaces = await authGet(`/api/wiki/team/${ctx.teamId}/spaces`, member.token);
    const starred = await authGet('/api/wiki/starred', member.token);
    for (const res of [labels, spaces, starred]) {
      expect(res.status).toBe(200);
      expect(JSON.stringify(res.body)).not.toContain(SECRET);
    }

    const mcp = await withMcpClient(member, (client) =>
      callTool(client, 'act', { action: 'space.list', input: { teamId: ctx.teamId } }),
    );
    expect(mcp.isError).toBe(false);
    expect(mcp.text).not.toContain(locked.id);
  });

  it("O: a viewer can't delete or resolve someone else's comment", async () => {
    const openPage = await prisma.page.findFirstOrThrow({ where: { spaceId, slug: 'parent' } });
    // A read-only member: VIEW on this space only
    const viewer = await addMemberToContext(ctx);
    const roSpace = await prisma.wikiSpace.create({
      data: {
        teamId: ctx.teamId,
        name: 'RO',
        slug: 'vis-ro',
        permissions: {
          create: [
            { userId: viewer.id, level: 'VIEW' },
            { userId: ctx.owner.id, level: 'ADMIN' },
          ],
        },
      },
    });
    const roPage = await prisma.page.create({
      data: { spaceId: roSpace.id, title: 'RO', slug: 'ro', body: 'x' },
    });
    const c1 = await prisma.pageComment.create({
      data: { pageId: roPage.id, userId: ctx.owner.id, body: 'owner says' },
    });
    try {
      const del = await authDel(`/api/wiki/comments/${c1.id}`, viewer.token);
      const resolve = await authPatch(`/api/wiki/comments/${c1.id}`, viewer.token, {});
      expect([del.status, resolve.status]).toEqual([403, 403]);
      const after = await prisma.pageComment.findUniqueOrThrow({ where: { id: c1.id } });
      expect(after.resolved).toBe(false);

      // The author may delete their own comment; an editor may resolve one on an editable page
      const own = await prisma.pageComment.create({
        data: { pageId: roPage.id, userId: viewer.id, body: 'mine' },
      });
      expect((await authDel(`/api/wiki/comments/${own.id}`, viewer.token)).status).toBe(204);
      const c2 = await prisma.pageComment.create({
        data: { pageId: openPage.id, userId: ctx.owner.id, body: 'resolve me' },
      });
      expect((await authPatch(`/api/wiki/comments/${c2.id}`, member.token, {})).status).toBe(200);
    } finally {
      await prisma.user.deleteMany({ where: { id: viewer.id } });
    }
  });

  it('18: MCP space.list gives every visible space, and only those', async () => {
    const team = await prisma.team.create({
      data: {
        orgId: ctx.orgId,
        name: 'Paging',
        slug: `paging-${Date.now()}`,
        members: { create: { userId: member.id, role: 'MEMBER' } },
      },
    });
    // Ids sort in creation order: visible, hidden, visible
    const first = await prisma.wikiSpace.create({
      data: { teamId: team.id, name: 'P1', slug: 'p1' },
    });
    await prisma.wikiSpace.create({
      data: {
        teamId: team.id,
        name: 'P2',
        slug: 'p2',
        permissions: { create: { userId: ctx.owner.id, level: 'ADMIN' } },
      },
    });
    const third = await prisma.wikiSpace.create({
      data: { teamId: team.id, name: 'P3', slug: 'p3' },
    });

    const res = await withMcpClient(member, (client) =>
      callTool(client, 'act', { action: 'space.list', input: { teamId: team.id } }),
    );
    expect(res.isError).toBe(false);
    const seen = (res.data as Array<{ id: string }>).map((space) => space.id);
    expect(seen.sort()).toEqual([first.id, third.id].sort());
  });

  it('20: no parent cycles, and a moved page takes its subtree along', async () => {
    const top = await prisma.page.create({
      data: { spaceId, title: 'Top', slug: `top-${Date.now()}`, body: '' },
    });
    const child = await prisma.page.create({
      data: { spaceId, parentId: top.id, title: 'Child', slug: `child-${Date.now()}`, body: '' },
    });
    const viaPatch = await authPatch(
      `/api/wiki/spaces/${spaceId}/pages/${top.slug}`,
      member.token,
      {
        parentId: child.id,
      },
    );
    const viaMove = await authPost(`/api/wiki/pages/${top.id}/move`, member.token, {
      targetParentId: child.id,
    });
    expect([viaPatch.status, viaMove.status]).toEqual([400, 400]);

    const target = await prisma.wikiSpace.create({
      data: { teamId: ctx.teamId, name: 'Target', slug: `target-${Date.now()}` },
    });
    const moved = await authPost(`/api/wiki/pages/${top.id}/move`, member.token, {
      targetSpaceId: target.id,
    });
    expect(moved.status).toBe(200);
    const after = await prisma.page.findMany({
      where: { id: { in: [top.id, child.id] } },
      select: { id: true, spaceId: true, parentId: true },
    });
    expect(after.every((p) => p.spaceId === target.id)).toBe(true);
    expect(after.find((p) => p.id === top.id)?.parentId).toBeNull();
    expect(after.find((p) => p.id === child.id)?.parentId).toBe(top.id);
  });

  it('N4: a cross-space move needs edit access to the whole subtree and stays in the org', async () => {
    const stamp = Date.now();
    const root = await prisma.page.create({
      data: { spaceId, title: 'Root', slug: `n4-root-${stamp}`, body: '' },
    });
    const hiddenChild = await prisma.page.create({
      data: { spaceId, parentId: root.id, title: 'Hidden', slug: `n4-hidden-${stamp}`, body: '' },
    });
    await prisma.pageRestriction.create({
      data: { pageId: hiddenChild.id, type: 'VIEW', userId: ctx.owner.id },
    });
    const target = await prisma.wikiSpace.create({
      data: { teamId: ctx.teamId, name: 'N4', slug: `n4-${stamp}` },
    });
    const res = await authPost(`/api/wiki/pages/${root.id}/move`, member.token, {
      targetSpaceId: target.id,
    });
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).toContain('1 page');
    expect((await prisma.page.findUniqueOrThrow({ where: { id: hiddenChild.id } })).spaceId).toBe(
      spaceId,
    );

    // Another org the member also belongs to (and can edit in): still refused
    const other = await createTestContext(`n4other${stamp}`);
    try {
      await prisma.orgMembership.create({
        data: { orgId: other.orgId, userId: member.id, role: 'MEMBER' },
      });
      await prisma.teamMembership.create({
        data: { teamId: other.teamId, userId: member.id, role: 'MEMBER' },
      });
      const foreign = await prisma.wikiSpace.create({
        data: { teamId: other.teamId, name: 'F', slug: `n4f-${stamp}` },
      });
      const open = await prisma.page.create({
        data: { spaceId, title: 'Open', slug: `n4-open-${stamp}`, body: '' },
      });
      const cross = await authPost(`/api/wiki/pages/${open.id}/move`, member.token, {
        targetSpaceId: foreign.id,
      });
      expect(cross.status).toBe(403);
    } finally {
      await cleanupTestContext(other);
    }
  });
});
