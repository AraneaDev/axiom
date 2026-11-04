import crypto from 'crypto';
import type { Server } from 'http';

import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { prisma } from '../config/database';
import app from '../index';
import {
  addMemberToContext,
  cleanupTestContext,
  createTestContext,
  type TestContext,
  type TestUser,
} from '../test/factory';
import { listenForRawRequests, rawRequest } from '../test/raw-request';

import { TOKEN_SCOPES } from './token-scopes';

/**
 * A fragment in the request target: Express routes without it, so the checks must read the path
 * without it too, or `/api/projects/P#/x` counts as a subpath and runs the project's own route.
 */
describe('a fragment in the request target', () => {
  let ctx: TestContext;
  let viewer: TestUser;
  let server: Server;
  let projectName: string;

  /**
   * Mint a real token.
   * @param scopes - The token's scopes
   * @param userId - Its user, by default the project's owner
   */
  async function tokenWith(scopes: string[], userId = ctx.owner.id): Promise<string> {
    const raw = `tk_${crypto.randomBytes(24).toString('hex')}`;
    await prisma.apiToken.create({
      data: {
        userId,
        name: 'fragment-test',
        tokenHash: crypto.createHash('sha256').update(raw).digest('hex'),
        prefix: raw.slice(0, 11),
        scopes,
      },
    });
    return `Token ${raw}`;
  }

  beforeAll(async () => {
    ctx = await createTestContext(`fragment-${Date.now()}`);
    viewer = await addMemberToContext(ctx);
    await prisma.teamMembership.update({
      where: { userId_teamId: { userId: viewer.id, teamId: ctx.teamId } },
      data: { role: 'VIEWER' },
    });
    server = await listenForRawRequests(app);
    const project = await prisma.project.findUniqueOrThrow({ where: { id: ctx.projectId } });
    projectName = project.name;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    await prisma.apiToken.deleteMany({ where: { name: 'fragment-test' } });
    await prisma.auditLog.deleteMany({ where: { userId: ctx.owner.id } });
    await cleanupTestContext(ctx);
  });

  describe('on a project', () => {
    it('refuses PATCH to a token, which would rename the project', async () => {
      const token = await tokenWith(['issues:write']);
      const res = await rawRequest(server, 'PATCH', `/api/projects/${ctx.projectId}#/x`, token, {
        name: 'renamed through a fragment',
      });
      expect(res.status).toBe(403);
      expect(res.body.error?.code).toBe('SCOPE');
      const project = await prisma.project.findUniqueOrThrow({ where: { id: ctx.projectId } });
      expect(project.name).toBe(projectName);
    });

    it('refuses DELETE to a token, which would delete the project', async () => {
      const token = await tokenWith(['issues:write']);
      const res = await rawRequest(server, 'DELETE', `/api/projects/${ctx.projectId}#/x`, token);
      expect(res.status).toBe(403);
      expect(res.body.error?.code).toBe('SCOPE');
      const project = await prisma.project.findUnique({ where: { id: ctx.projectId } });
      expect(project).not.toBeNull();
    });

    it('refuses PATCH with an absolute request target, routed the same', async () => {
      const token = await tokenWith(['issues:write']);
      const target = `http://localhost/api/projects/${ctx.projectId}#/x`;
      const res = await rawRequest(server, 'PATCH', target, token, { name: 'renamed' });
      expect(res.status).toBe(403);
      expect(res.body.error?.code).toBe('SCOPE');
    });

    it('asks HEAD for the scope of the project, not of a subpath', async () => {
      const token = await tokenWith(['issues:read']);
      const res = await rawRequest(server, 'HEAD', `/api/projects/${ctx.projectId}#/x`, token);
      expect(res.status).toBe(403);
    });
  });

  describe('under /api/admin', () => {
    it.each(['PATCH', 'DELETE', 'HEAD'])('refuses %s to a token holding every scope', async (m) => {
      const token = await tokenWith([...TOKEN_SCOPES]);
      const res = await rawRequest(server, m, '/api/admin/users#/x', token);
      expect(res.status).toBe(403);
      if (m !== 'HEAD') expect(res.body.error?.code).toBe('SCOPE');
    });
  });

  describe('on page restrictions', () => {
    it.each(['PUT', 'PATCH', 'DELETE'])('refuses %s to a wiki token', async (m) => {
      const token = await tokenWith(['wiki:write']);
      const res = await rawRequest(server, m, '/api/wiki/pages/P/restrictions#', token);
      expect(res.status).toBe(403);
      expect(res.body.error?.code).toBe('SCOPE');
    });

    it('refuses HEAD to a token without a wiki scope', async () => {
      const token = await tokenWith(['issues:write']);
      const res = await rawRequest(server, 'HEAD', '/api/wiki/pages/P/restrictions#', token);
      expect(res.status).toBe(403);
    });
  });

  describe('on the role check of project writes', () => {
    it('does not let a viewer pass as a personal vote or watch', async () => {
      const name = `fragment-label-${Date.now()}`;
      const res = await rawRequest(
        server,
        'POST',
        `/api/projects/${ctx.projectId}/labels#/issues/1/votes/toggle`,
        `Bearer ${viewer.token}`,
        { name, color: '#ff0000' },
      );
      expect(res.status).toBe(403);
      expect(res.body.error?.code).toBe('FORBIDDEN');
      expect(await prisma.label.count({ where: { name } })).toBe(0);
    });
  });
});

/**
 * An encoded slash stays inside one segment for Express, so `/issues/1%2Fvotes%2Ftoggle` routes
 * as `/issues/:issueNumber`. No check may read it as the path it would decode to.
 */
describe('an encoded slash in the request target', () => {
  let ctx: TestContext;
  let viewer: TestUser;
  let server: Server;
  let issueNumber: number;
  let issueId: string;
  const originalTitle = 'Not for a viewer to change';
  const OWNER = () => `Bearer ${ctx.owner.token}`;

  /**
   * Mint a real token for the viewer, who could make these writes only by a hole in the checks.
   * @param scopes - The token's scopes
   */
  async function viewerToken(scopes: string[]): Promise<string> {
    const raw = `tk_${crypto.randomBytes(24).toString('hex')}`;
    await prisma.apiToken.create({
      data: {
        userId: viewer.id,
        name: 'encoded-slash-test',
        tokenHash: crypto.createHash('sha256').update(raw).digest('hex'),
        prefix: raw.slice(0, 11),
        scopes,
      },
    });
    return `Token ${raw}`;
  }

  /** The viewer's two ways in: a browser session and an API token with write scope. */
  const viewerCallers: Array<[string, () => Promise<string>]> = [
    ['session', async () => `Bearer ${viewer.token}`],
    ['token', () => viewerToken(['issues:write'])],
  ];

  beforeAll(async () => {
    ctx = await createTestContext(`encoded-${Date.now()}`);
    viewer = await addMemberToContext(ctx);
    await prisma.teamMembership.update({
      where: { userId_teamId: { userId: viewer.id, teamId: ctx.teamId } },
      data: { role: 'VIEWER' },
    });
    server = await listenForRawRequests(app);
    const created = await request(app)
      .post(`/api/projects/${ctx.projectId}/issues`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Authorization', OWNER())
      .send({ title: originalTitle, type: 'TASK', priority: 'MEDIUM' });
    expect(created.status).toBe(201);
    issueNumber = created.body.number;
    issueId = created.body.id;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    await prisma.apiToken.deleteMany({ where: { name: 'encoded-slash-test' } });
    await prisma.auditLog.deleteMany({ where: { userId: ctx.owner.id } });
    await cleanupTestContext(ctx);
  });

  describe.each(viewerCallers)('from a viewer with a %s', (_name, caller) => {
    const disguises = (n: number) => [
      `${n}%2Fissues%2F${n}%2Fvotes%2Ftoggle`,
      `${n}%2Fissues%2F${n}%2Fwatchers%2Ftoggle`,
      `${n}%2fvotes%2ftoggle`,
    ];

    it('refuses PATCH spelled as a vote or watch, which would edit the issue', async () => {
      const authorization = await caller();
      for (const disguise of disguises(issueNumber)) {
        const res = await rawRequest(
          server,
          'PATCH',
          `/api/projects/${ctx.projectId}/issues/${disguise}`,
          authorization,
          { title: 'Changed by a viewer' },
        );
        expect(res.status, disguise).toBe(403);
        expect(res.body.error?.code, disguise).toBe('FORBIDDEN');
      }
      const issue = await prisma.issue.findUniqueOrThrow({ where: { id: issueId } });
      expect(issue.title).toBe(originalTitle);
    });

    it('refuses DELETE spelled as a vote or watch, which would delete the issue', async () => {
      const authorization = await caller();
      for (const disguise of disguises(issueNumber)) {
        const res = await rawRequest(
          server,
          'DELETE',
          `/api/projects/${ctx.projectId}/issues/${disguise}`,
          authorization,
        );
        expect(res.status, disguise).toBe(403);
        expect(res.body.error?.code, disguise).toBe('FORBIDDEN');
      }
      const issue = await prisma.issue.findUnique({ where: { id: issueId } });
      expect(issue?.deletedAt ?? null).toBeNull();
    });

    it.each(['votes', 'watchers'])('still lets the viewer toggle %s, a personal act', async (t) => {
      const res = await rawRequest(
        server,
        'POST',
        `/api/projects/${ctx.projectId}/issues/${issueNumber}/${t}/toggle`,
        await caller(),
      );
      expect(res.status).toBe(200);
    });
  });

  it('answers 400 for an issue number that is not all digits, even to the owner', async () => {
    const before = await prisma.issue.findUniqueOrThrow({ where: { id: issueId } });
    for (const spelling of [`${issueNumber}abc`, `${issueNumber}%2Fx`, `${issueNumber}.5`]) {
      const res = await rawRequest(
        server,
        'PATCH',
        `/api/projects/${ctx.projectId}/issues/${spelling}`,
        OWNER(),
        { title: 'Changed through a loose number' },
      );
      expect(res.status, spelling).toBe(400);
    }
    for (const subpath of ['votes', 'watchers', 'links']) {
      const res = await rawRequest(
        server,
        'GET',
        `/api/projects/${ctx.projectId}/issues/${issueNumber}abc/${subpath}`,
        OWNER(),
      );
      expect(res.status, subpath).toBe(400);
    }
    const after = await prisma.issue.findUniqueOrThrow({ where: { id: issueId } });
    expect(after.title).toBe(before.title);
  });

  it('counts for the token table as the one segment Express routes on', async () => {
    const authorization = await viewerToken(['issues:write']);
    for (const [method, target] of [
      ['PATCH', `/api/projects/${ctx.projectId}%2Fx`],
      ['DELETE', `/api/projects/${ctx.projectId}%2Fx`],
      ['PATCH', `/api/projects/${ctx.projectId}%5Cx`],
      ['DELETE', `/api/projects/${ctx.projectId}%5c`],
    ]) {
      const res = await rawRequest(server, method, target, authorization);
      expect(res.status, target).toBe(403);
      expect(res.body.error?.code, target).toBe('SCOPE');
    }
  });
});

describe('the audit record of a request', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext(`audit-${Date.now()}`);
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { userId: ctx.owner.id } });
    await cleanupTestContext(ctx);
  });

  it('takes its resource from the path, not from the query', async () => {
    const path = `/api/projects/${ctx.projectId}?note=/issues`;
    const res = await request(app)
      .patch(path)
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Authorization', `Bearer ${ctx.owner.token}`)
      .send({ name: 'Audited' });
    expect(res.status).toBe(200);

    await vi.waitFor(async () => {
      const row = await prisma.auditLog.findFirstOrThrow({
        where: { userId: ctx.owner.id, details: { path: ['path'], equals: path } },
      });
      expect(row.resource).toBe(`project:${ctx.projectId}`);
    });
  });
});
