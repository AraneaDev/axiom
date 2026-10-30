/**
 * REST writes follow the permission matrix in src/utils/permissions.ts: a VIEWER (org and
 * team) can read but not write issues, project content or wiki pages; a MEMBER can.
 */
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../../config/database';
import app from '../../index';
import {
  addMemberToContext,
  cleanupTestContext,
  createTestContext,
  type TestContext,
  type TestUser,
} from '../../test/factory';
import { authGet, authPatch, authPost } from '../../test/helpers';

describe('Role enforcement on REST writes', () => {
  let ctx: TestContext;
  let viewer: TestUser;
  let member: TestUser;
  let teamViewer: TestUser;
  let spaceId: string;
  let issueId: string;
  let columnId: string;

  beforeAll(async () => {
    ctx = await createTestContext(`roles${Date.now()}`);
    viewer = await addMemberToContext(ctx);
    await prisma.orgMembership.update({
      where: { userId_orgId: { userId: viewer.id, orgId: ctx.orgId } },
      data: { role: 'VIEWER' },
    });
    await prisma.teamMembership.update({
      where: { userId_teamId: { userId: viewer.id, teamId: ctx.teamId } },
      data: { role: 'VIEWER' },
    });
    member = await addMemberToContext(ctx);
    // The usual team VIEWER: invited to the team, so an org MEMBER
    teamViewer = await addMemberToContext(ctx);
    await prisma.teamMembership.update({
      where: { userId_teamId: { userId: teamViewer.id, teamId: ctx.teamId } },
      data: { role: 'VIEWER' },
    });
    spaceId = (
      await prisma.wikiSpace.create({ data: { teamId: ctx.teamId, name: 'R', slug: 'roles' } })
    ).id;
    await prisma.page.create({ data: { spaceId, title: 'Page', slug: 'page', body: 'x' } });
    issueId = (
      await prisma.issue.create({
        data: {
          projectId: ctx.projectId,
          number: 1,
          title: 'I',
          body: '',
          creatorId: ctx.owner.id,
        },
      })
    ).id;
    columnId = (await prisma.boardColumn.findFirstOrThrow({ where: { projectId: ctx.projectId } }))
      .id;
  });

  afterAll(async () => {
    await cleanupTestContext(ctx);
    await prisma.user.deleteMany({ where: { id: { in: [viewer.id, member.id, teamViewer.id] } } });
  });

  const writes = () => {
    const P = `/api/projects/${ctx.projectId}`;
    const stamp = Date.now();
    return [
      ['create issue', 'post', `${P}/issues`, { title: 'v' }],
      ['update issue', 'patch', `${P}/issues/1`, { title: 'v' }],
      ['comment', 'post', `${P}/issues/1/comments`, { body: 'v' }],
      ['board column', 'post', `${P}/board/columns`, { name: `C${stamp}` }],
      ['label', 'post', `${P}/labels`, { name: `l${stamp}`, color: '#123456' }],
      [
        'sprint',
        'post',
        `${P}/sprints`,
        {
          name: 'S',
          startDate: new Date().toISOString(),
          endDate: new Date(Date.now() + 86_400_000).toISOString(),
        },
      ],
      ['milestone', 'post', `${P}/milestones`, { title: 'M' }],
      ['issue template', 'post', `${P}/issue-templates`, { name: `t${stamp}`, title: 't' }],
      ['custom field', 'post', `${P}/custom-fields`, { name: `f${stamp}`, type: 'TEXT' }],
      ['issue field value', 'put', `/api/issues/${issueId}/custom-fields/nope`, { value: 'x' }],
      ['roadmap bucket', 'post', `${P}/roadmap/buckets`, { name: 'B' }],
      ['wiki page', 'post', `/api/wiki/spaces/${spaceId}/pages`, { title: 'W', slug: `w${stamp}` }],
      ['wiki edit', 'patch', `/api/wiki/spaces/${spaceId}/pages/page`, { body: 'changed' }],
      ['move issue', 'patch', `${P}/issues/1/move`, { columnId, position: 0 }],
    ] as const;
  };

  const send = (token: string, method: string, path: string, body: object) =>
    method === 'post'
      ? authPost(path, token, body)
      : method === 'patch'
        ? authPatch(path, token, body)
        : import('../../test/helpers').then((h) => h.authPut(path, token, body));

  it('refuses every write to a VIEWER', async () => {
    const allowed: string[] = [];
    for (const [name, method, path, body] of writes()) {
      const res = await send(viewer.token, method, path, body);
      if (res.status !== 403) allowed.push(`${name}: ${res.status}`);
    }
    const upload = await request(app)
      .post('/api/attachments')
      .set('Authorization', `Bearer ${viewer.token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .field('issueId', issueId)
      .attach('file', Buffer.from('hello'), 'hello.txt');
    if (upload.status !== 403) allowed.push(`attachment: ${upload.status}`);
    expect(allowed).toEqual([]);
    expect((await authGet(`/api/projects/${ctx.projectId}/issues/1`, viewer.token)).status).toBe(
      200,
    );
  });

  it('refuses every write to an org MEMBER whose team role is VIEWER: the team role wins', async () => {
    const allowed: string[] = [];
    for (const [name, method, path, body] of writes()) {
      const res = await send(teamViewer.token, method, path, body);
      if (res.status !== 403) allowed.push(`${name}: ${res.status}`);
    }
    expect(allowed).toEqual([]);
  });

  it('lets a MEMBER write', async () => {
    const res = await authPost(`/api/projects/${ctx.projectId}/issues`, member.token, {
      title: 'm',
    });
    expect(res.status).toBe(201);
    const wiki = await authPatch(`/api/wiki/spaces/${spaceId}/pages/page`, member.token, {
      body: 'by member',
    });
    expect(wiki.status).toBe(200);
  });

  it('reserves project settings to team ADMINs and org OWNERs/ADMINs', async () => {
    const P = `/api/projects/${ctx.projectId}`;
    const cols = await prisma.boardColumn.findMany({
      where: { projectId: ctx.projectId },
      orderBy: { position: 'asc' },
      take: 2,
    });
    const field = await prisma.customFieldDefinition.create({
      data: { projectId: ctx.projectId, name: `cf${Date.now()}`, type: 'TEXT' },
    });
    const stamp = Date.now();
    const settings = [
      [
        'approval gate',
        'post',
        `${P}/approval-gates`,
        { fromColumnId: cols[0].id, toColumnId: cols[1].id },
      ],
      [
        'workflow rule',
        'post',
        `${P}/workflow-rules`,
        { fromColumnId: cols[0].id, toColumnId: cols[1].id },
      ],
      [
        'automation rule',
        'post',
        `${P}/automation-rules`,
        { name: 'r', trigger: 'issue:created', actions: [] },
      ],
      ['custom field', 'post', `${P}/custom-fields`, { name: `x${stamp}`, type: 'TEXT' }],
      ['custom field edit', 'patch', `/api/custom-fields/${field.id}`, { name: 'renamed' }],
      ['board column', 'post', `${P}/board/columns`, { name: `S${stamp}` }],
      ['form', 'post', `${P}/forms`, { name: 'F', slug: `f-${stamp}` }],
      ['issue template', 'post', `${P}/issue-templates`, { name: `t${stamp}`, title: 't' }],
    ] as const;
    const allowed: string[] = [];
    for (const [name, method, path, body] of settings) {
      const res = await send(member.token, method, path, body);
      if (res.status !== 403) allowed.push(`${name}: ${res.status}`);
    }
    expect(allowed).toEqual([]);

    // A team ADMIN may
    await prisma.teamMembership.update({
      where: { userId_teamId: { userId: member.id, teamId: ctx.teamId } },
      data: { role: 'ADMIN' },
    });
    try {
      const res = await authPost(`${P}/board/columns`, member.token, { name: `A${stamp}` });
      expect(res.status).toBe(201);
    } finally {
      await prisma.teamMembership.update({
        where: { userId_teamId: { userId: member.id, teamId: ctx.teamId } },
        data: { role: 'MEMBER' },
      });
    }
  });

  it('16: a VIEWER can still vote on and watch an issue: both are personal', async () => {
    const P = `/api/projects/${ctx.projectId}/issues/1`;
    const vote = await authPost(`${P}/votes/toggle`, viewer.token, {});
    const watch = await authPost(`${P}/watchers/toggle`, viewer.token, {});
    expect([vote.status, watch.status]).toEqual([200, 200]);
  });
});
