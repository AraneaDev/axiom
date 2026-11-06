import crypto from 'node:crypto';

import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createPrismaClient, prisma } from '../../config/database';
import app from '../../index';
import { decryptSecret, secretContext } from '../../lib/secret-box';
import { createTestUser, type TestUser } from '../../test/factory';
import { useGithubFake } from '../../test/github-fake';
import { seedGithubApp } from '../../test/github-seed';
import { postWebhook } from '../../test/github-webhook';

import { refreshUserToken } from './github-account.service';
import { requireGithubAccount, resolveGithubActor } from './github-actor';
import { getGithubAppSecrets } from './github-app.service';
import { githubRequest } from './github-client';
import { GITHUB_INTEGRATION_USER_ID } from './integration-user';

const CSRF = { 'X-Requested-With': 'XMLHttpRequest' };
const BASE = '/api/github/account';
const fake = useGithubFake();

let alice: TestUser;
let bob: TestUser;
const clients: Array<ReturnType<typeof createPrismaClient>> = [];

/**
 * An API token for a user, as an agent holds it.
 * @param userId - Its user
 * @param scopes - Its scopes
 * @returns What the agent sends
 */
async function tokenOf(userId: string, scopes: string[]): Promise<string> {
  const raw = `tk_${crypto.randomBytes(24).toString('hex')}`;
  await prisma.apiToken.create({
    data: {
      userId,
      name: 'github-agent',
      scopes,
      prefix: raw.slice(0, 11),
      tokenHash: crypto.createHash('sha256').update(raw).digest('hex'),
    },
  });
  return raw;
}

const as = (user: TestUser) => ({ ...CSRF, Authorization: `Bearer ${user.token}` });
const post = (url: string, user: TestUser, body: object = {}) =>
  request(app).post(url).set(as(user)).send(body);

/**
 * Starts the connection and returns the state GitHub would be sent.
 * @param user - Who connects
 */
async function start(user: TestUser) {
  const res = await post(`${BASE}/connect`, user);
  const state = res.status === 200 ? new URL(res.body.authorizeUrl).searchParams.get('state')! : '';
  return { res, state };
}

/**
 * The whole flow for a GitHub login.
 * @param user - Who connects
 * @param login - Their GitHub login
 * @param githubUserId - Their GitHub id
 */
async function connect(user: TestUser, login: string, githubUserId?: number) {
  const { state } = await start(user);
  const code = fake.issueAuthorizationCode(login, { githubUserId });
  const res = await post(`${BASE}/connect/complete`, user, { code, state });
  return { res, code, state };
}

const accountOf = (user: TestUser) =>
  prisma.githubAccount.findUniqueOrThrow({ where: { userId: user.id } });
const plain = (
  field: 'accessToken' | 'refreshToken',
  row: { id: string } & Record<string, unknown>,
) => decryptSecret(row[field] as string, secretContext('githubAccount', field, row.id));

beforeAll(async () => {
  alice = await createTestUser();
  bob = await createTestUser();
});

beforeEach(async () => {
  await seedGithubApp({ fake });
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await prisma.githubAccount.deleteMany();
  await prisma.githubSetupState.deleteMany();
  await prisma.githubApp.deleteMany();
});

afterAll(async () => {
  for (const client of clients) await client.$disconnect();
  const ids = [alice.id, bob.id];
  await prisma.apiToken.deleteMany({ where: { userId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: ids } } });
  await prisma.refreshToken.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
});

describe('connecting a GitHub account', () => {
  it('goes through GitHub and stores both tokens sealed', async () => {
    const started = await start(alice);
    expect(started.res.status).toBe(200);
    const url = new URL(started.res.body.authorizeUrl);
    expect(url.origin + url.pathname).toBe(`${fake.url}/web/login/oauth/authorize`);
    expect(url.searchParams.get('client_id')).toBe('Iv1.0a1b2c3d4e5f6a7b');
    expect(url.searchParams.get('redirect_uri')).toMatch(/\/settings\/github\/callback$/);

    const code = fake.issueAuthorizationCode('octo-dev', { githubUserId: 9101 });
    const done = await post(`${BASE}/connect/complete`, alice, { code, state: started.state });
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ connected: true, login: 'octo-dev', githubUserId: 9101 });

    const row = await accountOf(alice);
    expect(row.accessToken.startsWith('enc:v1:')).toBe(true);
    expect(row.refreshToken!.startsWith('enc:v1:')).toBe(true);
    expect(plain('accessToken', row)).toMatch(/^ghu_/);
    expect(plain('refreshToken', row)).toMatch(/^ghr_/);
    expect(row.accessTokenExpiresAt!.getTime()).toBeGreaterThan(Date.now());

    const got = await request(app).get(BASE).set(as(alice));
    expect(got.body).toMatchObject({ connected: true, login: 'octo-dev', githubUserId: 9101 });
    expect((await request(app).get(BASE).set(as(bob))).body).toEqual({ connected: false });
  });

  it('is refused while no App is set up', async () => {
    await prisma.githubApp.deleteMany();
    const res = await post(`${BASE}/connect`, alice);
    expect(res.status).toBe(409);
    expect(await prisma.githubSetupState.count()).toBe(0);
  });

  it.each([
    ['one that was already used', 'used'],
    ['one that expired', 'expired'],
    ['one that belongs to someone else', 'foreign'],
    ['one that never existed', 'unknown'],
    ['one made for the manifest flow', 'manifest'],
  ])('refuses %s, and makes no call to GitHub', async (_label, kind) => {
    const started = await start(alice);
    let state = started.state;
    if (kind === 'used') await prisma.githubSetupState.delete({ where: { state } });
    if (kind === 'expired') {
      await prisma.githubSetupState.update({ where: { state }, data: { expiresAt: new Date(0) } });
    }
    if (kind === 'unknown') state = 'nope';
    if (kind === 'manifest') {
      await prisma.githubSetupState.update({ where: { state }, data: { purpose: 'manifest' } });
    }
    const code = fake.issueAuthorizationCode('octo-dev');
    const res = await post(`${BASE}/connect/complete`, kind === 'foreign' ? bob : alice, {
      code,
      state,
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_STATE');
    expect(fake.requests.filter((r) => r.path !== '/')).toEqual([]);
    expect(await prisma.githubAccount.count()).toBe(0);
  });

  it('lets a state be used once, even when two calls arrive together', async () => {
    const { state } = await start(alice);
    const codes = [
      fake.issueAuthorizationCode('octo-dev'),
      fake.issueAuthorizationCode('octo-dev'),
    ];
    const results = await Promise.all(
      codes.map((code) => post(`${BASE}/connect/complete`, alice, { code, state })),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
    expect(await prisma.githubAccount.count()).toBe(1);
  });

  it('refuses a GitHub user who is connected to another Axiom user', async () => {
    expect((await connect(alice, 'octo-dev', 9101)).res.status).toBe(200);
    const second = await connect(bob, 'octo-dev', 9101);
    expect(second.res.status).toBe(409);
    expect(second.res.body.error.code).toBe('GITHUB_ACCOUNT_TAKEN');
    expect(await prisma.githubAccount.count()).toBe(1);
  });

  it('replaces the account when the same person connects another one', async () => {
    await connect(alice, 'octo-dev', 9101);
    const first = await accountOf(alice);
    expect((await connect(alice, 'review-bot', 9102)).res.status).toBe(200);
    const row = await accountOf(alice);
    expect(row.login).toBe('review-bot');
    expect(row.id).toBe(first.id);
    expect(plain('accessToken', row)).toMatch(/^ghu_/);
  });

  it('turns a rejected code into an error without echoing it', async () => {
    const { state } = await start(alice);
    const res = await post(`${BASE}/connect/complete`, alice, { code: 'deadbeef1234', state });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toContain('deadbeef1234');
    expect(await prisma.githubAccount.count()).toBe(0);
  });

  it('is web UI only: a token holding github:write is refused with SCOPE', async () => {
    const token = await tokenOf(alice.id, ['github:write']);
    for (const [method, url, body] of [
      ['post', `${BASE}/connect`, {}],
      ['post', `${BASE}/connect/complete`, { code: 'abc', state: 'def' }],
      ['delete', BASE, undefined],
    ] as const) {
      const agent = request(app);
      const res = await agent[method](url)
        .set(CSRF)
        .set('Authorization', `Token ${token}`)
        .send(body);
      expect(res.status, `${method} ${url}`).toBe(403);
      expect(res.body.error.code).toBe('SCOPE');
    }
  });

  it('can be read by a github:read token, and by no other scope', async () => {
    await connect(alice, 'octo-dev', 9101);
    const reader = await tokenOf(alice.id, ['github:read']);
    const ok = await request(app).get(BASE).set(CSRF).set('Authorization', `Token ${reader}`);
    expect(ok.status).toBe(200);
    expect(ok.body.login).toBe('octo-dev');
    const other = await tokenOf(alice.id, ['issues:read']);
    const no = await request(app).get(BASE).set(CSRF).set('Authorization', `Token ${other}`);
    expect(no.status).toBe(403);
  });
});

describe('disconnecting', () => {
  it('deletes the row and asks GitHub to revoke the token with the App credentials', async () => {
    await connect(alice, 'octo-dev', 9101);
    const token = plain('accessToken', await accountOf(alice));
    const res = await request(app).delete(BASE).set(as(alice));
    expect(res.status).toBe(200);
    expect(await prisma.githubAccount.count()).toBe(0);
    const revoke = fake.requests.find((r) => r.method === 'DELETE');
    expect(revoke?.path).toBe('/applications/Iv1.0a1b2c3d4e5f6a7b/token');
    expect(revoke?.headers.authorization).toBe('basic');
    expect(fake.isTokenValid(token)).toBe(false);
  });

  it('still deletes when GitHub refuses, and logs no token', async () => {
    const logs: string[] = [];
    const { logger } = await import('../../utils/logger');
    for (const level of ['info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(logger, level).mockImplementation((...args: unknown[]) => {
        logs.push(JSON.stringify(args));
        return logger;
      });
    }
    await connect(alice, 'octo-dev', 9101);
    const row = await accountOf(alice);
    const secrets = [plain('accessToken', row), plain('refreshToken', row)];
    fake.on('DELETE /applications/:client_id/token', {
      status: 500,
      body: { message: secrets[0] },
    });
    const res = await request(app).delete(BASE).set(as(alice));
    expect(res.status).toBe(200);
    expect(await prisma.githubAccount.count()).toBe(0);
    for (const secret of secrets) expect(logs.join('\n')).not.toContain(secret);
  });

  it('answers 200 with connected false when nothing was connected', async () => {
    const res = await request(app).delete(BASE).set(as(alice));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ connected: false });
  });

  it('is done when the App is forgotten', async () => {
    await connect(alice, 'octo-dev', 9101);
    const { deleteApp } = await import('./github-app.service');
    await deleteApp();
    expect(await prisma.githubAccount.count()).toBe(0);
  });
});

describe('calling GitHub as a connected user', () => {
  /**
   * Makes the access token expire in a minute, which is inside the 5 minute margin.
   * @param user - Whose account
   */
  const expireSoon = (user: TestUser) =>
    prisma.githubAccount.update({
      where: { userId: user.id },
      data: { accessTokenExpiresAt: new Date(Date.now() + 60_000) },
    });

  it('uses the stored token and does not refresh one that is good', async () => {
    await connect(alice, 'octo-dev', 9101);
    const res = await githubRequest<{ login: string }>(
      { kind: 'user', userId: alice.id },
      'GET',
      '/user',
    );
    expect(res.data.login).toBe('octo-dev');
    expect(fake.refreshGrants).toBe(0);
  });

  it('refreshes a token that expires within 5 minutes, once, and keeps the rotated refresh token', async () => {
    await connect(alice, 'octo-dev', 9101);
    const before = await accountOf(alice);
    await expireSoon(alice);
    const first = await githubRequest<{ login: string }>(
      { kind: 'user', userId: alice.id },
      'GET',
      '/user',
    );
    expect(first.data.login).toBe('octo-dev');
    expect(fake.refreshGrants).toBe(1);
    const after = await accountOf(alice);
    expect(plain('accessToken', after)).not.toBe(plain('accessToken', before));
    expect(plain('refreshToken', after)).not.toBe(plain('refreshToken', before));
    expect(after.refreshToken!.startsWith('enc:v1:')).toBe(true);
    expect(after.accessTokenExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 60 * 60_000);
    // The next call uses what was stored
    await githubRequest({ kind: 'user', userId: alice.id }, 'GET', '/user');
    expect(fake.refreshGrants).toBe(1);
    // and the next refresh presents the rotated token, which GitHub accepts
    await expireSoon(alice);
    await githubRequest({ kind: 'user', userId: alice.id }, 'GET', '/user');
    expect(fake.refreshGrants).toBe(2);
  });

  it('refreshes once when two processes need it at the same moment', async () => {
    await connect(alice, 'octo-dev', 9101);
    await expireSoon(alice);
    fake.setRefreshDelay(300);
    const urlA = createPrismaClient();
    const urlB = createPrismaClient();
    clients.push(urlA, urlB);
    const [a, b] = await Promise.all([
      refreshUserToken(alice.id, urlA),
      refreshUserToken(alice.id, urlB),
    ]);
    expect(fake.refreshGrants).toBe(1);
    expect(a).toBe(b);
    expect(a).toBe(plain('accessToken', await accountOf(alice)));
    fake.setRefreshDelay(0);
  });

  it('refreshes once when several calls arrive together through the client', async () => {
    await connect(alice, 'octo-dev', 9101);
    await expireSoon(alice);
    fake.setRefreshDelay(150);
    const auth = { kind: 'user', userId: alice.id } as const;
    await Promise.all([1, 2, 3].map(() => githubRequest(auth, 'GET', '/user')));
    expect(fake.refreshGrants).toBe(1);
    fake.setRefreshDelay(0);
  });

  it('deletes the account and asks for a new connection on bad_refresh_token', async () => {
    await connect(alice, 'octo-dev', 9101);
    await expireSoon(alice);
    fake.revokeRefreshTokens('octo-dev');
    const err = await githubRequest({ kind: 'user', userId: alice.id }, 'GET', '/user').catch(
      (e) => e,
    );
    expect(err).toMatchObject({
      statusCode: 409,
      code: 'GITHUB_RECONNECT',
      message: 'Your GitHub connection expired. Connect GitHub again in Settings.',
    });
    expect(await prisma.githubAccount.count()).toBe(0);
  });

  it('does the same when the token endpoint answers 401', async () => {
    await connect(alice, 'octo-dev', 9101);
    await expireSoon(alice);
    fake.on('POST /web/login/oauth/access_token', {
      status: 401,
      body: { message: 'Bad credentials' },
    });
    const err = await githubRequest({ kind: 'user', userId: alice.id }, 'GET', '/user').catch(
      (e) => e,
    );
    expect(err).toMatchObject({ statusCode: 409, code: 'GITHUB_RECONNECT' });
    expect(await prisma.githubAccount.count()).toBe(0);
  });

  it('keeps the account when GitHub is down, and fails with a 502', async () => {
    await connect(alice, 'octo-dev', 9101);
    await expireSoon(alice);
    fake.on('POST /web/login/oauth/access_token', { status: 503, body: { message: 'down' } });
    const err = await githubRequest({ kind: 'user', userId: alice.id }, 'GET', '/user').catch(
      (e) => e,
    );
    expect(err.statusCode).toBe(502);
    expect(await prisma.githubAccount.count()).toBe(1);
  });

  it('asks to connect when the user has no account', async () => {
    const err = await githubRequest({ kind: 'user', userId: bob.id }, 'GET', '/user').catch(
      (e) => e,
    );
    expect(err).toMatchObject({ statusCode: 409, code: 'GITHUB_NOT_CONNECTED' });
  });
});

describe('requireGithubAccount and resolveGithubActor', () => {
  it('requires a connection, with no fallback to the bot', async () => {
    const err = await requireGithubAccount(bob.id).catch((e) => e);
    expect(err).toMatchObject({
      statusCode: 409,
      code: 'GITHUB_NOT_CONNECTED',
      message: 'Connect your GitHub account in Settings first',
    });
    await connect(alice, 'octo-dev', 9101);
    expect(await requireGithubAccount(alice.id)).toEqual({ githubUserId: 9101, login: 'octo-dev' });
  });

  it('maps a connected GitHub user, else the integration user with the login kept', async () => {
    await connect(alice, 'octo-dev', 9101);
    expect(await resolveGithubActor({ id: 9101, login: 'octo-dev-renamed' })).toEqual({
      userId: alice.id,
      login: 'octo-dev-renamed',
      mapped: true,
    });
    expect(await resolveGithubActor({ id: 9555, login: 'stranger' })).toEqual({
      userId: GITHUB_INTEGRATION_USER_ID,
      login: 'stranger',
      mapped: false,
    });
    expect(await resolveGithubActor(null)).toEqual({
      userId: GITHUB_INTEGRATION_USER_ID,
      login: 'ghost',
      mapped: false,
    });
  });
});

describe('the github_app_authorization webhook', () => {
  it('deletes the account of the GitHub user who revoked', async () => {
    await connect(alice, 'octo-dev', 9101);
    await connect(bob, 'review-bot', 9102);
    const res = await postWebhook('github_app_authorization', {
      action: 'revoked',
      sender: { id: 9101, login: 'octo-dev' },
    });
    expect(res.status).toBeLessThan(300);
    await vi.waitFor(async () => expect(await prisma.githubAccount.count()).toBe(1));
    expect((await accountOf(bob)).login).toBe('review-bot');
  });

  it('ignores a revoke for a GitHub user nobody connected, and other actions', async () => {
    await connect(alice, 'octo-dev', 9101);
    await postWebhook('github_app_authorization', {
      action: 'revoked',
      sender: { id: 1, login: 'x' },
    });
    await postWebhook('github_app_authorization', {
      action: 'other',
      sender: { id: 9101, login: 'octo-dev' },
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await prisma.githubAccount.count()).toBe(1);
  });
});

describe('secrecy', () => {
  it('never puts a token, code or client secret in an answer, an audit row or a log line', async () => {
    const logs: string[] = [];
    const { logger } = await import('../../utils/logger');
    for (const level of ['info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(logger, level).mockImplementation((...args: unknown[]) => {
        logs.push(JSON.stringify(args));
        return logger;
      });
    }
    const answers: string[] = [];
    const started = await post(`${BASE}/connect`, alice);
    answers.push(JSON.stringify(started.body));
    const state = new URL(started.body.authorizeUrl).searchParams.get('state')!;
    const code = fake.issueAuthorizationCode('octo-dev', { githubUserId: 9101 });
    answers.push(
      JSON.stringify((await post(`${BASE}/connect/complete`, alice, { code, state })).body),
    );
    // Reuse, a rejected code and a taken account are errors that hold no secret either
    answers.push(
      JSON.stringify((await post(`${BASE}/connect/complete`, alice, { code, state })).body),
    );
    const taken = await start(bob);
    const code2 = fake.issueAuthorizationCode('octo-dev', { githubUserId: 9101 });
    answers.push(
      JSON.stringify(
        (await post(`${BASE}/connect/complete`, bob, { code: code2, state: taken.state })).body,
      ),
    );
    answers.push(JSON.stringify((await request(app).get(BASE).set(as(alice))).body));
    for (const name of ['githubAccount.get']) {
      const res = await request(app)
        .post('/api/act')
        .set(as(alice))
        .send({ action: name, input: {} });
      answers.push(JSON.stringify(res.body));
    }
    // A refresh, and a failed one
    const row = await accountOf(alice);
    const secrets = [
      plain('accessToken', row),
      plain('refreshToken', row),
      code,
      code2,
      (await getGithubAppSecrets())!.clientSecret,
    ];
    await prisma.githubAccount.update({
      where: { userId: alice.id },
      data: { accessTokenExpiresAt: new Date(Date.now() + 1000) },
    });
    await githubRequest({ kind: 'user', userId: alice.id }, 'GET', '/user');
    secrets.push(
      plain('accessToken', await accountOf(alice)),
      plain('refreshToken', await accountOf(alice)),
    );
    fake.revokeRefreshTokens('octo-dev');
    await prisma.githubAccount.update({
      where: { userId: alice.id },
      data: { accessTokenExpiresAt: new Date(Date.now() + 1000) },
    });
    answers.push(
      JSON.stringify(
        await githubRequest({ kind: 'user', userId: alice.id }, 'GET', '/user').catch(
          (e) => e.message,
        ),
      ),
    );
    await connect(alice, 'octo-dev', 9101);
    secrets.push(plain('accessToken', await accountOf(alice)));
    answers.push(JSON.stringify((await request(app).delete(BASE).set(as(alice))).body));

    const audits = JSON.stringify(
      await prisma.auditLog.findMany({ where: { userId: { in: [alice.id, bob.id] } } }),
    );
    const haystack = [...answers, audits, ...logs].join('\n');
    for (const secret of secrets) {
      expect(secret.length).toBeGreaterThan(8);
      expect(haystack).not.toContain(secret);
    }
  });
});
