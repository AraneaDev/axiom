/**
 * What the migration of project settings (plan 4, task 3a) changed in behaviour: strict paging on
 * labels, a custom field value that must be a value, bounded list positions, the role named in a
 * refusal, and the access order of a record addressed by its own id.
 */
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { recordInProject } from '../../actions/authorize';
import type { ActionContext } from '../../actions/define';
import { prisma } from '../../config/database';
import app from '../../index';
import {
  addMemberToContext,
  cleanupTestContext,
  createTestContext,
  createTestUser,
  type TestContext,
  type TestUser,
} from '../../test/factory';

const XHR = { 'X-Requested-With': 'XMLHttpRequest' };

describe('project settings behaviour', () => {
  let ctx: TestContext;
  let member: TestUser;
  let viewer: TestUser;
  let stranger: TestUser;
  let P: string;
  let issueId: string;
  let fieldId: string;

  const as = (user: TestUser) => ({ userId: user.id, channel: 'ui' }) as ActionContext;
  const send = (method: 'get' | 'post' | 'patch' | 'put', path: string, user: TestUser) =>
    request(app)[method](path).set('Authorization', `Bearer ${user.token}`).set(XHR);

  beforeAll(async () => {
    ctx = await createTestContext(`behave${Date.now()}`);
    member = await addMemberToContext(ctx);
    viewer = await addMemberToContext(ctx);
    await prisma.teamMembership.updateMany({
      where: { userId: viewer.id, teamId: ctx.teamId },
      data: { role: 'VIEWER' },
    });
    stranger = await createTestUser();
    P = `/api/projects/${ctx.projectId}`;
    issueId = (
      await prisma.issue.create({
        data: {
          projectId: ctx.projectId,
          number: 1,
          title: 'Behave',
          body: '',
          creatorId: ctx.owner.id,
        },
      })
    ).id;
    fieldId = (
      await prisma.customFieldDefinition.create({
        data: { projectId: ctx.projectId, name: 'Customer', type: 'TEXT' },
      })
    ).id;
  });

  afterAll(async () => {
    await cleanupTestContext(ctx);
    await prisma.user.deleteMany({ where: { id: { in: [member.id, viewer.id, stranger.id] } } });
  });

  describe('label paging', () => {
    it.each(['abc', '-1', '1.5', '1e3', '0x10'])(
      'refuses limit=%s and offset=%s',
      async (value) => {
        const limit = await send('get', `${P}/labels?limit=${value}`, ctx.owner);
        const offset = await send('get', `${P}/labels?offset=${value}`, ctx.owner);
        expect([limit.status, offset.status]).toEqual([400, 400]);
      },
    );

    it('takes digits', async () => {
      const res = await send('get', `${P}/labels?limit=5&offset=0`, ctx.owner);
      expect(res.status).toBe(200);
    });
  });

  describe('custom field values', () => {
    const put = (value: unknown) =>
      send('put', `/api/issues/${issueId}/custom-fields/${fieldId}`, ctx.owner).send({ value });

    it.each([[null], [{ a: 1 }], [[1, 2]]])('refuses %j, which is no value', async (value) => {
      expect((await put(value)).status).toBe(400);
    });

    it('stores a number and a boolean as their text', async () => {
      const number = await put(42);
      expect(number.status).toBe(200);
      expect(number.body.value).toBe('42');
      expect((await put(true)).body.value).toBe('true');
    });
  });

  describe('list positions', () => {
    it.each([-1, 100_001, 1.5])('refuse position %s on a column', async (position) => {
      const res = await send('post', `${P}/board/columns`, ctx.owner).send({
        name: `Col ${position}`,
        position,
      });
      expect(res.status).toBe(400);
    });

    it('take the top of the range', async () => {
      const res = await send('post', `${P}/board/columns`, ctx.owner).send({
        name: 'Last column',
        position: 100_000,
      });
      expect(res.status).toBe(201);
    });
  });

  describe('the role named in a refusal on a settings route', () => {
    it('is manage_members for a team member who may edit issues but not the settings', async () => {
      const res = await send('post', `${P}/board/columns`, member).send({ name: 'Nope' });
      expect(res.status).toBe(403);
      expect(res.body.error.message).toContain('team:manage_members');
    });

    it('is manage_members for a viewer too, where REST once said issue:edit', async () => {
      const res = await send('post', `${P}/custom-fields`, viewer).send({
        name: 'X',
        type: 'TEXT',
      });
      expect(res.status).toBe(403);
      expect(res.body.error.message).toContain('team:manage_members');
    });
  });

  describe('recordInProject', () => {
    const resolve = async (id: string) => (id === 'issue' ? ctx.projectId : undefined);
    const pick = (input: { id: string }) => input.id;

    it('answers 404 with the route message for a record that is not there', async () => {
      const authorize = recordInProject(resolve, 'Thing not found', pick);
      await expect(authorize(as(ctx.owner), { id: 'gone' })).rejects.toMatchObject({
        statusCode: 404,
        message: 'Thing not found',
      });
    });

    it('lets a reader of the project read, and turns a stranger away', async () => {
      const authorize = recordInProject(resolve, 'Thing not found', pick);
      await expect(authorize(as(viewer), { id: 'issue' })).resolves.toBeUndefined();
      await expect(authorize(as(stranger), { id: 'issue' })).rejects.toMatchObject({
        statusCode: expect.any(Number),
      });
    });

    it('checks each role in the order given, so the first it lacks is the one named', async () => {
      const both = recordInProject(resolve, 'Thing not found', pick, [
        'issue:edit',
        'team:manage_members',
      ]);
      await expect(both(as(ctx.owner), { id: 'issue' })).resolves.toBeUndefined();
      await expect(both(as(member), { id: 'issue' })).rejects.toThrow('team:manage_members');
      await expect(both(as(viewer), { id: 'issue' })).rejects.toThrow('issue:edit');
    });

    it('answers 404 for a missing record before it looks at the role', async () => {
      const authorize = recordInProject(resolve, 'Thing not found', pick, ['issue:edit']);
      await expect(authorize(as(viewer), { id: 'gone' })).rejects.toMatchObject({
        statusCode: 404,
      });
    });
  });
});
