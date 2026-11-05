/**
 * The registry alone decides what a token reaches. Every registered action, by name, and every
 * REST binding is called with a token of each scope that covers it, and with one token holding
 * every scope that does not: the answer is the SCOPE refusal exactly where the action's own checks
 * give it, and every REST call reaches the action, so nothing in front of it (a path rule, a
 * router) answers for it. Scopes only add reach, so the token of all the others stands for each
 * of them alone, and for none.
 */
import crypto from 'crypto';

import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { prisma } from '../config/database';
import app from '../index';
import { TOKEN_SCOPES } from '../middleware/token-scopes';
import { cleanupTestContext, createTestContext, type TestContext } from '../test/factory';

import type { ActionContext, ActionDef } from './define';
import * as execute from './execute';
import { listActions } from './registry';

const CSRF = { 'X-Requested-With': 'XMLHttpRequest' };

/**
 * The tokens to call an action with: each scope that covers it alone, and every other scope at once.
 * @param def - The action
 */
function scopeSets(def: ActionDef): string[][] {
  const covering = TOKEN_SCOPES.filter((scope) => !registryRefuses(def, [scope], false));
  const others = TOKEN_SCOPES.filter((scope) => !covering.includes(scope));
  return [...covering.map((scope) => [scope]), others];
}

/** Under ACT_LIMIT: the by-name walk spreads its calls over users so the limit never answers */
const ACT_CALLS_PER_USER = 200;

/**
 * Mint a real token.
 * @param userId - Its user
 * @param scopes - Its scopes
 */
async function mintToken(userId: string, scopes: string[]): Promise<string> {
  const raw = `tk_${crypto.randomBytes(24).toString('hex')}`;
  await prisma.apiToken.create({
    data: {
      userId,
      name: 'token-reach',
      tokenHash: crypto.createHash('sha256').update(raw).digest('hex'),
      prefix: raw.slice(0, 11),
      scopes,
    },
  });
  return `Token ${raw}`;
}

/**
 * Whether the action's own checks refuse this token its scope.
 * @param def - The action
 * @param scopes - The token's scopes
 * @param byName - Whether it is called by name rather than over its binding
 */
function registryRefuses(def: ActionDef, scopes: string[], byName: boolean): boolean {
  const ctx: ActionContext = {
    userId: 'probe',
    apiTokenId: 'probe',
    scopes,
    channel: 'rest-token',
    ...(byName ? { byName: {} } : { http: {} as NonNullable<ActionContext['http']> }),
  };
  return execute.actionRefusal(def, ctx)?.code === 'SCOPE';
}

/**
 * What a request answered, for a failure message.
 * @param res - The response
 * @param res.status - Its status
 * @param res.body - Its body
 */
function answer(res: { status: number; body: unknown }): string {
  const code = (res.body as { error?: { code?: string } } | undefined)?.error?.code;
  return `${res.status} ${code ?? ''}`.trim();
}

type Verb = 'get' | 'post' | 'put' | 'patch' | 'delete';

/**
 * A request to the app with any method.
 * @param method - The HTTP method
 * @param target - The path
 */
function call(method: string, target: string) {
  return request(app)[method.toLowerCase() as Verb](target);
}

describe('the registry alone decides what a token reaches', () => {
  let ctx: TestContext;
  const users: string[] = [];

  beforeAll(async () => {
    ctx = await createTestContext(`tokenreach${Date.now()}`);
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await prisma.agentApproval.deleteMany({ where: { userId: { in: [ctx.owner.id, ...users] } } });
    await prisma.apiToken.deleteMany({ where: { userId: { in: [ctx.owner.id, ...users] } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await cleanupTestContext(ctx);
  });

  it('answers every REST binding as the action decides, for each scope', async () => {
    const bindings = listActions().filter((def) => def.rest && !def.rest.public);
    expect(bindings.length).toBeGreaterThan(200);
    const spy = vi.spyOn(execute, 'executeAction');
    const tokens = new Map<string, string>();
    const wrong: string[] = [];
    for (const def of bindings) {
      for (const scopes of scopeSets(def)) {
        const key = scopes.join();
        if (!tokens.has(key)) tokens.set(key, await mintToken(ctx.owner.id, scopes));
        const { method, path } = def.rest!;
        const concrete = path.replace(/:[A-Za-z_]+/g, 'x');
        const calls = spy.mock.calls.length;
        const res = await call(method, concrete)
          .set(CSRF)
          .set('Authorization', tokens.get(key)!)
          .send(method === 'GET' ? undefined : {});
        const label = `${def.name} ${method} ${concrete} with [${key}]`;
        if (spy.mock.calls.length === calls) {
          wrong.push(`${label}: answered ${answer(res)} before the action ran`);
          continue;
        }
        const refused = res.status === 403 && res.body?.error?.code === 'SCOPE';
        if (registryRefuses(def, scopes, false) !== refused) {
          wrong.push(`${label}: the action refuses ${!refused}, the request got ${answer(res)}`);
        }
      }
    }
    spy.mockRestore();
    expect(wrong).toEqual([]);
  }, 300_000);

  it('answers every action by name as the action decides, for each scope', async () => {
    const wrong: string[] = [];
    let tokens = new Map<string, string>();
    let userId = '';
    let calls = 0;
    for (const def of listActions()) {
      for (const scopes of scopeSets(def)) {
        if (calls++ % ACT_CALLS_PER_USER === 0) {
          const user = await prisma.user.create({
            data: {
              email: `token-reach-${crypto.randomUUID()}@test.dev`,
              username: `token-reach-${crypto.randomUUID()}`,
              displayName: 'Token reach',
              passwordHash: 'unused',
            },
          });
          users.push(user.id);
          userId = user.id;
          tokens = new Map();
        }
        const key = scopes.join();
        if (!tokens.has(key)) tokens.set(key, await mintToken(userId, scopes));
        const res = await request(app)
          .post('/api/act')
          .set(CSRF)
          .set('Authorization', tokens.get(key)!)
          .send({ action: def.name, input: {} });
        const refused = res.status === 403 && res.body?.error?.code === 'SCOPE';
        if (registryRefuses(def, scopes, true) !== refused) {
          wrong.push(
            `${def.name} by name with [${key}]: the action refuses ${!refused}, ` +
              `the request got ${answer(res)}`,
          );
        }
      }
    }
    expect(wrong).toEqual([]);
  }, 300_000);
});
