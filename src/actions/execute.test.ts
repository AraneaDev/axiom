import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { prisma } from '../config/database';
import { attributionFields, getRequestContext } from '../lib/request-context';
import { AppError, errorHandler } from '../middleware/errorHandler';
import { projectOf } from '../middleware/requireProjectAccess';
import { TOKEN_SCOPES } from '../middleware/token-scopes';
import {
  addMemberToContext,
  cleanupTestContext,
  createTestContext,
  createTestUser,
  type TestContext,
  type TestUser,
} from '../test/factory';
import { validate } from '../utils/validation/common-validators';

import {
  ownedByProject,
  pageAccess,
  projectAction,
  projectRead,
  spaceAccess,
  teamRead,
} from './authorize';
import { defineAction, type ActionContext } from './define';
import { executeAction } from './execute';
import { getAction, listActions, registerActions } from './registry';

const USER_ID = 'user-1';
const session: ActionContext = { userId: USER_ID, channel: 'ui' };
const wikiOnlyScopes = ['wiki:read', 'wiki:write'];
/** The same wiki-only token, as it reaches executeAction through each adapter */
const wikiToken: ActionContext = {
  userId: USER_ID,
  apiTokenId: 'token-1',
  apiTokenName: 'ci-bot',
  scopes: wikiOnlyScopes,
  channel: 'rest-token',
};
const wikiTokenOverMcp: ActionContext = { ...wikiToken, channel: 'mcp' };

const issueInput = z.object({ title: z.string().min(3) });
const issueHandler = vi.fn(async (_ctx: ActionContext, input: { title: string }) => ({
  id: 'i1',
  title: input.title,
}));
const issueAuthorize = vi.fn(async () => {});
const wikiHandler = vi.fn(async () => ({ id: 'p1' }));
const refusedHandler = vi.fn(async () => ({ ok: true }));
const uiOnlyHandler = vi.fn(async () => ({ ok: true }));
const rawHandler = vi.fn(async () => undefined);

const output = z.looseObject({ id: z.string() });

registerActions([
  defineAction({
    name: 'test.issueWrite',
    area: 'issues',
    kind: 'write',
    summary: 'A throwaway issue write',
    input: issueInput,
    output,
    authorize: issueAuthorize,
    handler: issueHandler,
  }),
  defineAction({
    name: 'test.wikiRead',
    area: 'wiki',
    kind: 'read',
    summary: 'A throwaway wiki read',
    input: z.object({}),
    output,
    authorize: async () => {},
    handler: wikiHandler,
  }),
  defineAction({
    name: 'test.refused',
    area: 'wiki',
    kind: 'read',
    summary: 'Authorize always refuses',
    input: z.object({}),
    output: z.looseObject({ ok: z.boolean() }),
    authorize: async () => {
      throw new AppError(403, 'Nope', 'FORBIDDEN');
    },
    handler: refusedHandler,
  }),
  defineAction({
    name: 'test.uiOnly',
    area: 'admin',
    kind: 'write',
    summary: 'Never open to a token',
    input: z.object({}),
    output: z.looseObject({ ok: z.boolean() }),
    uiOnly: true,
    authorize: async () => {},
    handler: uiOnlyHandler,
  }),
  defineAction({
    name: 'test.raw',
    area: 'wiki',
    kind: 'read',
    summary: 'Writes straight to the response',
    input: z.object({}),
    output: z.undefined(),
    rest: { method: 'GET', path: '/api/test/raw', raw: true },
    authorize: async () => {},
    handler: rawHandler,
  }),
  defineAction({
    name: 'test.drift',
    area: 'wiki',
    kind: 'read',
    summary: 'Returns something its output schema does not allow',
    input: z.object({}),
    output,
    authorize: async () => {},
    // @ts-expect-error The drift this action exists to show
    handler: async () => ({ id: 42 }),
  }),
  defineAction({
    name: 'test.loose',
    area: 'wiki',
    kind: 'read',
    summary: 'Returns more keys than its output schema names',
    input: z.object({}),
    output: z.object({ id: z.string() }),
    authorize: async () => {},
    handler: async () => ({ id: 'p1', extra: 'kept' }),
  }),
  defineAction({
    name: 'test.attribution',
    area: 'wiki',
    kind: 'read',
    summary: 'Reports what services would see while it runs',
    input: z.object({}),
    output: z.looseObject({ channel: z.string() }),
    authorize: async () => {},
    handler: async () => ({
      channel: getRequestContext()?.channel ?? 'none',
      userId: getRequestContext()?.userId,
      ...attributionFields(),
    }),
  }),
]);

/**
 * The AppError a rejected execution threw.
 * @param name - The action
 * @param input - Its raw input
 * @param ctx - Who runs it
 */
async function refusal(name: string, input: unknown, ctx: ActionContext): Promise<AppError> {
  const err = await executeAction(name, input, ctx).then(
    () => {
      throw new Error(`${name} was not refused`);
    },
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AppError);
  return err as AppError;
}

describe('executeAction', () => {
  it('rejects an unknown action with 404 UNKNOWN_ACTION', async () => {
    const err = await refusal('test.nope', {}, session);
    expect(err.statusCode).toBe(404);
    expect(err.code).toBe('UNKNOWN_ACTION');
    // Names on Object.prototype are not actions either
    expect((await refusal('constructor', {}, session)).code).toBe('UNKNOWN_ACTION');
  });

  it('enforces the token scope before validation', async () => {
    issueAuthorize.mockClear();
    issueHandler.mockClear();
    const err = await refusal('test.issueWrite', { title: 'x' }, wikiToken);
    expect(err.statusCode).toBe(403);
    expect(err.code).toBe('SCOPE');
    expect(issueAuthorize).not.toHaveBeenCalled();
    expect(issueHandler).not.toHaveBeenCalled();
  });

  it('returns the validation error shape used by REST', async () => {
    const app = express();
    app.get('/rest', () => {
      validate(issueInput, { title: 'x' });
    });
    app.get('/action', async (_req, _res, next) => {
      await executeAction('test.issueWrite', { title: 'x' }, session).catch(next);
    });
    app.use(errorHandler);

    const rest = await request(app).get('/rest');
    const action = await request(app).get('/action');

    expect(rest.status).toBe(400);
    expect(rest.body.error.message).toContain('title:');
    expect(action.status).toBe(rest.status);
    expect(action.body).toEqual(rest.body);
  });

  it('runs authorize before the handler', async () => {
    refusedHandler.mockClear();
    const err = await refusal('test.refused', {}, session);
    expect(err.statusCode).toBe(403);
    expect(err.message).toBe('Nope');
    expect(refusedHandler).not.toHaveBeenCalled();
  });

  it('passes the parsed input to authorize and the handler', async () => {
    issueAuthorize.mockClear();
    issueHandler.mockClear();
    const ctx: ActionContext = { ...wikiToken, scopes: ['issues:write'] };
    const result = await executeAction('test.issueWrite', { title: 'abc', junk: 1 }, ctx);
    expect(result).toEqual({ id: 'i1', title: 'abc' });
    expect(issueAuthorize).toHaveBeenCalledWith(ctx, { title: 'abc' });
    expect(issueHandler).toHaveBeenCalledWith(ctx, { title: 'abc' });
    expect(issueAuthorize.mock.invocationCallOrder[0]).toBeLessThan(
      issueHandler.mock.invocationCallOrder[0],
    );
  });

  it('refuses uiOnly actions to tokens', async () => {
    uiOnlyHandler.mockClear();
    // No scope opens these, not even a token holding all of them. Same answer as tokenAllows.
    const allScopes = [...TOKEN_SCOPES];
    for (const channel of ['rest-token', 'mcp'] as const) {
      const err = await refusal(
        'test.uiOnly',
        {},
        {
          userId: USER_ID,
          apiTokenId: 't',
          apiTokenName: 'n',
          scopes: allScopes,
          channel,
        },
      );
      expect(err.statusCode).toBe(403);
      expect(err.code).toBe('SCOPE');
    }
    expect(uiOnlyHandler).not.toHaveBeenCalled();

    await expect(executeAction('test.uiOnly', {}, session)).resolves.toEqual({ ok: true });
  });

  it('does not scope a browser session', async () => {
    await expect(executeAction('test.issueWrite', { title: 'abc' }, session)).resolves.toEqual({
      id: 'i1',
      title: 'abc',
    });
  });

  it('treats a token context without scopes as holding none', async () => {
    for (const ctx of [
      { userId: USER_ID, channel: 'mcp' },
      { userId: USER_ID, channel: 'rest-token' },
      { userId: USER_ID, apiTokenId: 't', channel: 'ui' },
      { userId: USER_ID, scopes: [], channel: 'ui' },
    ] as ActionContext[]) {
      const err = await refusal('test.wikiRead', {}, ctx);
      expect(err.statusCode).toBe(403);
      expect(err.code).toBe('SCOPE');
    }
  });

  it('refuses a raw action without the REST response, after the scope check', async () => {
    rawHandler.mockClear();
    const err = await refusal('test.raw', {}, wikiTokenOverMcp);
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe('RAW_ACTION');
    expect(rawHandler).not.toHaveBeenCalled();

    const noScope = await refusal('test.raw', {}, { ...wikiTokenOverMcp, scopes: [] });
    expect(noScope.code).toBe('SCOPE');

    const http = { req: {}, res: {} } as NonNullable<ActionContext['http']>;
    await executeAction('test.raw', {}, { ...wikiToken, http });
    expect(rawHandler).toHaveBeenCalledOnce();
  });

  it('fails on output that drifts from the schema while testing', async () => {
    await expect(executeAction('test.drift', {}, session)).rejects.toThrow(
      /test\.drift returned output that does not match its schema/,
    );
  });

  it('returns the handler result as is, whatever the output schema strips', async () => {
    await expect(executeAction('test.loose', {}, session)).resolves.toEqual({
      id: 'p1',
      extra: 'kept',
    });
  });

  it('skips the output check outside tests', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    try {
      await expect(executeAction('test.drift', {}, session)).resolves.toEqual({ id: 42 });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('attributes what the handler does to the context it was given', async () => {
    await expect(executeAction('test.attribution', {}, wikiTokenOverMcp)).resolves.toEqual({
      channel: 'mcp',
      userId: USER_ID,
      apiTokenId: 'token-1',
      via: 'ci-bot',
    });
    await expect(executeAction('test.attribution', {}, session)).resolves.toEqual({
      channel: 'ui',
      userId: USER_ID,
      apiTokenId: null,
      via: null,
    });
  });
});

describe('one scope path for REST and MCP', () => {
  it('refuses an out-of-area action the same way on both channels', async () => {
    const rest = await refusal('test.issueWrite', { title: 'abc' }, wikiToken);
    const mcp = await refusal('test.issueWrite', { title: 'abc' }, wikiTokenOverMcp);
    expect(rest.statusCode).toBe(403);
    expect(rest.code).toBe('SCOPE');
    expect({ status: mcp.statusCode, code: mcp.code, message: mcp.message }).toEqual({
      status: rest.statusCode,
      code: rest.code,
      message: rest.message,
    });
  });

  it('allows an in-area action the same way on both channels', async () => {
    wikiHandler.mockClear();
    await expect(executeAction('test.wikiRead', {}, wikiToken)).resolves.toEqual({ id: 'p1' });
    await expect(executeAction('test.wikiRead', {}, wikiTokenOverMcp)).resolves.toEqual({
      id: 'p1',
    });
    expect(wikiHandler).toHaveBeenCalledTimes(2);
  });

  it('does not let read scope write on either channel', async () => {
    for (const channel of ['rest-token', 'mcp'] as const) {
      const err = await refusal(
        'test.issueWrite',
        { title: 'abc' },
        { ...wikiToken, scopes: ['issues:read'], channel },
      );
      expect(err.code).toBe('SCOPE');
    }
  });

  it('still runs authorize for a covered token on both channels', async () => {
    refusedHandler.mockClear();
    for (const ctx of [wikiToken, wikiTokenOverMcp]) {
      const err = await refusal('test.refused', {}, ctx);
      expect(err.statusCode).toBe(403);
      expect(err.message).toBe('Nope');
    }
    expect(refusedHandler).not.toHaveBeenCalled();
  });
});

describe('registry', () => {
  it('finds and lists registered actions', () => {
    expect(getAction('test.wikiRead')?.area).toBe('wiki');
    expect(getAction('test.nope')).toBeUndefined();
    expect(listActions().map((a) => a.name)).toContain('test.issueWrite');
  });

  it('refuses a second action with the same name', () => {
    const before = getAction('test.wikiRead');
    expect(() =>
      registerActions([
        defineAction({
          name: 'test.wikiRead',
          area: 'admin',
          kind: 'write',
          summary: 'Would replace the original',
          input: z.object({}),
          output,
          authorize: async () => {},
          handler: async () => ({ id: 'x' }),
        }),
      ]),
    ).toThrow(/test\.wikiRead/);
    expect(getAction('test.wikiRead')).toBe(before);
  });
});

describe('authorizers', () => {
  let t: TestContext;
  let other: TestContext;
  /** In the org with an org role, on no team */
  let orgOnly: TestUser;
  /** On the team as VIEWER */
  let viewer: TestUser;
  /** In no org at all */
  let stranger: TestUser;
  let spaceId: string;
  let pageId: string;
  let restrictedPageId: string;
  let issueId: string;

  const asUser = (user: TestUser, channel: ActionContext['channel'] = 'ui'): ActionContext => ({
    userId: user.id,
    channel,
    ...(channel === 'ui' ? {} : { scopes: [...TOKEN_SCOPES], apiTokenId: 't', apiTokenName: 'n' }),
  });

  const status = (run: Promise<void>) =>
    run.then(
      () => 'ok' as const,
      (e: unknown) => {
        if (e instanceof AppError)
          return { status: e.statusCode, message: e.message, code: e.code };
        throw e;
      },
    );

  beforeAll(async () => {
    t = await createTestContext(`acta${Date.now()}`);
    other = await createTestContext(`actb${Date.now()}`);
    orgOnly = await createTestUser();
    stranger = await createTestUser();
    await prisma.orgMembership.create({
      data: { userId: orgOnly.id, orgId: t.orgId, role: 'MEMBER' },
    });
    viewer = await addMemberToContext(t);
    await prisma.teamMembership.update({
      where: { userId_teamId: { userId: viewer.id, teamId: t.teamId } },
      data: { role: 'VIEWER' },
    });

    const space = await prisma.wikiSpace.create({
      data: { name: 'Actions', slug: 'actions', teamId: t.teamId },
    });
    spaceId = space.id;
    const page = await prisma.page.create({
      data: { title: 'Open', slug: 'open', body: '', spaceId },
    });
    pageId = page.id;
    const restricted = await prisma.page.create({
      data: { title: 'Closed', slug: 'closed', body: '', spaceId },
    });
    restrictedPageId = restricted.id;
    await prisma.pageRestriction.create({
      data: { pageId: restrictedPageId, type: 'VIEW', userId: t.owner.id },
    });
    const issue = await prisma.issue.create({
      data: {
        title: 'Owned',
        body: '',
        number: 1,
        projectId: t.projectId,
        creatorId: t.owner.id,
      },
    });
    issueId = issue.id;
  });

  afterAll(async () => {
    await cleanupTestContext(t);
    await cleanupTestContext(other);
    await prisma.user.deleteMany({
      where: { id: { in: [orgOnly.id, stranger.id, viewer.id] } },
    });
  });

  it('projectRead needs a place on the project team', async () => {
    const check = projectRead((i: { projectId: string }) => i.projectId);
    const input = { projectId: t.projectId };
    expect(await status(check(asUser(t.owner), input))).toBe('ok');
    expect(await status(check(asUser(viewer), input))).toBe('ok');
    expect(await status(check(asUser(orgOnly), input))).toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
    });
    expect(await status(check(asUser(t.owner), { projectId: 'missing' }))).toMatchObject({
      status: 404,
    });
  });

  it('projectAction keeps the access check REST runs before the role check', async () => {
    const check = projectAction('issue:edit', (i: { projectId: string }) => i.projectId);
    const input = { projectId: t.projectId };
    expect(await status(check(asUser(t.owner), input))).toBe('ok');
    // The org role alone allows issue:edit, but REST turns away whoever is not on the team
    expect(await status(check(asUser(orgOnly), input))).toMatchObject({
      status: 403,
      message: 'Access denied',
    });
    expect(await status(check(asUser(viewer), input))).toMatchObject({
      status: 403,
      message: 'Insufficient permissions: issue:edit',
      code: 'FORBIDDEN',
    });
    expect(await status(check(asUser(t.owner), { projectId: 'missing' }))).toMatchObject({
      status: 404,
    });
  });

  it('spaceAccess needs the org as well as the space level', async () => {
    const view = spaceAccess('VIEW', (i: { spaceId: string }) => i.spaceId);
    const edit = spaceAccess('EDIT', (i: { spaceId: string }) => i.spaceId);
    const input = { spaceId };
    expect(await status(edit(asUser(t.owner), input))).toBe('ok');
    expect(await status(view(asUser(viewer), input))).toBe('ok');
    expect(await status(edit(asUser(viewer), input))).toMatchObject({
      status: 403,
      message: 'You do not have access to this space',
    });
    expect(await status(view(asUser(stranger), input))).toMatchObject({
      status: 403,
      code: 'NOT_ORG_MEMBER',
    });
    expect(await status(view(asUser(t.owner), { spaceId: 'missing' }))).toMatchObject({
      status: 404,
    });
  });

  it('pageAccess honours the org, the space and the page restrictions', async () => {
    const view = pageAccess('view', (i: { pageId: string }) => i.pageId);
    const edit = pageAccess('edit', (i: { pageId: string }) => i.pageId);
    expect(await status(view(asUser(viewer), { pageId }))).toBe('ok');
    expect(await status(edit(asUser(viewer), { pageId }))).toMatchObject({ status: 403 });
    expect(await status(edit(asUser(t.owner), { pageId }))).toBe('ok');
    expect(await status(view(asUser(stranger), { pageId }))).toMatchObject({
      status: 403,
      code: 'NOT_ORG_MEMBER',
    });
    expect(await status(view(asUser(viewer), { pageId: restrictedPageId }))).toMatchObject({
      status: 403,
      message: 'You do not have access to this page',
    });
    expect(await status(view(asUser(t.owner), { pageId: 'missing' }))).toMatchObject({
      status: 404,
    });
  });

  it('teamRead lets the team and org admins in, not a plain org member', async () => {
    const check = teamRead((i: { teamId: string }) => i.teamId);
    const input = { teamId: t.teamId };
    expect(await status(check(asUser(viewer), input))).toBe('ok');
    expect(await status(check(asUser(orgOnly), input))).toMatchObject({ status: 403 });
    expect(await status(check(asUser(t.owner), { teamId: 'missing' }))).toMatchObject({
      status: 404,
    });
  });

  it('ownedByProject refuses a record of another project, and a project the user cannot read', async () => {
    const check = ownedByProject(projectOf.issue, (i: { projectId: string; id: string }) => ({
      projectId: i.projectId,
      recordId: i.id,
    }));
    expect(await status(check(asUser(t.owner), { projectId: t.projectId, id: issueId }))).toBe(
      'ok',
    );
    // other.owner reads their own project, and names an issue of ours through it
    expect(
      await status(check(asUser(other.owner), { projectId: other.projectId, id: issueId })),
    ).toMatchObject({ status: 404, message: 'Not found in this project' });
    expect(
      await status(check(asUser(other.owner), { projectId: t.projectId, id: issueId })),
    ).toMatchObject({ status: 403 });
    expect(
      await status(check(asUser(t.owner), { projectId: t.projectId, id: 'missing' })),
    ).toMatchObject({ status: 404 });
  });

  it('answers the same for a token over REST and over MCP', async () => {
    const def = defineAction({
      name: 'test.projectWrite',
      area: 'issues',
      kind: 'write',
      summary: 'A real authorizer behind the registry',
      input: z.object({ projectId: z.string() }),
      output,
      authorize: projectAction('issue:edit', (i) => i.projectId),
      handler: async () => ({ id: 'x' }),
    });
    registerActions([def]);
    const input = { projectId: t.projectId };

    for (const channel of ['rest-token', 'mcp'] as const) {
      const viewerErr = await refusal('test.projectWrite', input, asUser(viewer, channel));
      expect(viewerErr.message).toBe('Insufficient permissions: issue:edit');
      const orgOnlyErr = await refusal('test.projectWrite', input, asUser(orgOnly, channel));
      expect(orgOnlyErr.message).toBe('Access denied');
      await expect(
        executeAction('test.projectWrite', input, asUser(t.owner, channel)),
      ).resolves.toEqual({ id: 'x' });
    }
  });
});
