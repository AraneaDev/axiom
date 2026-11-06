import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { getAction } from '../../actions/registry';
import { prisma } from '../../config/database';
import app from '../../index';
import { createTestUser, type TestUser } from '../../test/factory';
import { useGithubFake } from '../../test/github-fake';
import { seedGithubApp } from '../../test/github-seed';

import {
  appManifest,
  clearInstallationTokens,
  deleteApp,
  getGithubAppSecrets,
} from './github-app.service';
import { githubRequest, setGithubBaseUrls } from './github-client';

const CSRF = { 'X-Requested-With': 'XMLHttpRequest' };
const BASE = '/api/github/app';
const fake = useGithubFake();
const FIXTURE = JSON.parse(
  readFileSync(
    path.join(__dirname, '../../test/__fixtures__/github/base/convert-manifest.json'),
    'utf8',
  ),
).body as { client_secret: string; webhook_secret: string };

let admin: TestUser;
let other: TestUser;
let member: TestUser;

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
 * Starts the flow as the admin and finishes it with a fresh code.
 * @param user - Who runs both steps
 */
async function setUpApp(user: TestUser = admin) {
  const started = await post(`${BASE}/manifest`, user);
  expect(started.status).toBe(200);
  const done = await post(`${BASE}/manifest/complete`, user, {
    code: fake.issueManifestCode(),
    state: started.body.state,
  });
  return { started, done };
}

beforeAll(async () => {
  admin = await createTestUser();
  other = await createTestUser();
  member = await createTestUser();
  await prisma.user.updateMany({
    where: { id: { in: [admin.id, other.id] } },
    data: { isAdmin: true },
  });
});

beforeEach(async () => {
  await prisma.githubApp.deleteMany();
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  setGithubBaseUrls({ api: fake.url, web: `${fake.url}/web` });
  clearInstallationTokens();
  for (const id of [4101, 4102, 4103, 4104]) fake.removeInstallation(id);
  await prisma.githubApp.deleteMany();
  await prisma.githubInstallation.deleteMany();
  await prisma.githubSetupState.deleteMany();
});

afterAll(async () => {
  const ids = [admin.id, other.id, member.id];
  await prisma.agentApproval.deleteMany({ where: { userId: { in: ids } } });
  await prisma.apiToken.deleteMany({ where: { userId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: ids } } });
  await prisma.refreshToken.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
});

describe('starting the manifest flow', () => {
  it('is refused to a person who is not a platform admin', async () => {
    const res = await post(`${BASE}/manifest`, member);
    expect(res.status).toBe(403);
    expect(await prisma.githubSetupState.count()).toBe(0);
  });

  it('is refused to every token, whatever its scopes: it is web UI only', async () => {
    const token = await tokenOf(admin.id, ['github:write', 'admin:write']);
    const res = await request(app)
      .post(`${BASE}/manifest`)
      .set(CSRF)
      .set('Authorization', `Token ${token}`)
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('SCOPE');
    for (const name of [
      'githubApp.startManifest',
      'githubApp.completeManifest',
      'githubApp.syncInstallations',
      'githubApp.delete',
    ]) {
      expect(getAction(name)).toMatchObject({ uiOnly: true, admin: true, noOrg: true });
    }
  });

  it('stores a state for ten minutes and answers the manifest and the page to post it to', async () => {
    const res = await post(`${BASE}/manifest`, admin);
    expect(res.status).toBe(200);
    const row = await prisma.githubSetupState.findUniqueOrThrow({
      where: { state: res.body.state },
    });
    expect(row).toMatchObject({ userId: admin.id, purpose: 'manifest' });
    const minutes = (row.expiresAt.getTime() - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(9);
    expect(minutes).toBeLessThanOrEqual(10);
    expect(res.body.postUrl).toBe(
      `${fake.url}/web/settings/apps/new?state=${encodeURIComponent(res.body.state)}`,
    );
    expect(res.body.manifest).toEqual(appManifest(res.body.manifest.url));
  });

  it('keeps the name inside GitHub 34 characters by shortening the host', () => {
    const long = appManifest('https://axiom.internal.engineering.acme-labs.example') as {
      name: string;
    };
    expect(long.name.length).toBeLessThanOrEqual(34);
    expect(long.name).toBe('Axiom (axiom.internal.engineering)');
    expect((appManifest('https://axiom.acme.test') as { name: string }).name).toBe(
      'Axiom (axiom.acme.test)',
    );
  });

  it('keeps at most 5 open states per person, dropping the oldest', async () => {
    const states: string[] = [];
    for (let i = 0; i < 7; i++) {
      states.push((await post(`${BASE}/manifest`, admin)).body.state);
      // Distinct expiry times, so "oldest" is defined
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const left = (await prisma.githubSetupState.findMany({ where: { userId: admin.id } })).map(
      (r) => r.state,
    );
    expect(left.sort()).toEqual(states.slice(2).sort());
    const other2 = await post(`${BASE}/manifest`, other);
    expect(other2.status).toBe(200);
    expect(await prisma.githubSetupState.count({ where: { userId: admin.id } })).toBe(5);
  });

  it('builds the manifest from the origin', () => {
    const manifest = appManifest('https://axiom.acme.test') as Record<string, unknown>;
    expect(manifest).toMatchObject({
      name: 'Axiom (axiom.acme.test)',
      url: 'https://axiom.acme.test',
      hook_attributes: { url: 'https://axiom.acme.test/api/github/webhook' },
      redirect_url: 'https://axiom.acme.test/admin/github/created',
      callback_urls: ['https://axiom.acme.test/settings/github/callback'],
      setup_url: 'https://axiom.acme.test/admin/github/installed',
      public: false,
      request_oauth_on_install: false,
      default_permissions: {
        metadata: 'read',
        contents: 'write',
        pull_requests: 'write',
        checks: 'read',
        actions: 'write',
        issues: 'write',
        statuses: 'read',
      },
      default_events: [
        'pull_request',
        'pull_request_review',
        'check_run',
        'check_suite',
        'workflow_job',
        'push',
        'create',
        'delete',
        'issues',
        'issue_comment',
      ],
    });
  });

  it('takes an organization only when it is a GitHub login', async () => {
    const ok = await post(`${BASE}/manifest`, admin, { organization: 'acme-labs' });
    expect(ok.status).toBe(200);
    expect(ok.body.postUrl).toContain('/web/organizations/acme-labs/settings/apps/new?state=');
    for (const organization of [
      '../evil',
      'acme/labs',
      '-acme',
      'acme labs',
      'a'.repeat(40),
      '',
      'acme?x=1',
      'acme\n',
    ]) {
      const res = await post(`${BASE}/manifest`, admin, { organization });
      expect(res.status, JSON.stringify(organization)).toBe(400);
    }
    expect(await prisma.githubSetupState.count()).toBe(1);
  });

  it('answers 409 GITHUB_APP_EXISTS once an App is set up', async () => {
    await seedGithubApp();
    const res = await post(`${BASE}/manifest`, admin);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('GITHUB_APP_EXISTS');
  });
});

describe('completing the manifest flow', () => {
  it('keeps the manifest code out of the logs when the conversion fails', async () => {
    const logs: string[] = [];
    const { logger } = await import('../../utils/logger');
    for (const level of ['info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(logger, level).mockImplementation((...args: unknown[]) => {
        logs.push(JSON.stringify(args));
        return logger;
      });
    }
    // A 5xx from GitHub
    const first = await post(`${BASE}/manifest`, admin);
    const serverCode = fake.issueManifestCode();
    fake.on('POST /app-manifests/:code/conversions', { status: 503, body: { message: 'down' } });
    const failed = await post(`${BASE}/manifest/complete`, admin, {
      code: serverCode,
      state: first.body.state,
    });
    expect(failed.status).toBeGreaterThanOrEqual(500);
    // GitHub not answering at all (the same log line as a timeout)
    const second = await post(`${BASE}/manifest`, admin);
    const lostCode = fake.issueManifestCode();
    setGithubBaseUrls({ api: 'http://127.0.0.1:1', web: `${fake.url}/web` });
    const lost = await post(`${BASE}/manifest/complete`, admin, {
      code: lostCode,
      state: second.body.state,
    });
    expect(lost.status).toBe(502);
    const haystack = logs.join('\n');
    expect(haystack).toContain('/app-manifests/[redacted]');
    for (const code of [serverCode, lostCode]) {
      expect(haystack).not.toContain(code);
      expect(JSON.stringify([failed.body, lost.body])).not.toContain(code);
    }
  });

  it('refuses a conversion without a webhook secret and stores nothing', async () => {
    const { logger } = await import('../../utils/logger');
    vi.spyOn(logger, 'error').mockImplementation(() => logger);
    const started = await post(`${BASE}/manifest`, admin);
    fake.on('POST /app-manifests/:code/conversions', {
      status: 201,
      body: { ...FIXTURE, webhook_secret: null },
    });
    const res = await post(`${BASE}/manifest/complete`, admin, {
      code: fake.issueManifestCode(),
      state: started.body.state,
    });
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('GITHUB_APP_INCOMPLETE');
    expect(res.body.error.message).toContain('Delete the App on GitHub');
    expect(await prisma.githubApp.count()).toBe(0);
  });

  it('says in the 409 that an App may exist on GitHub unstored', async () => {
    await seedGithubApp();
    const res = await post(`${BASE}/manifest`, admin);
    expect(res.body.error.message).toContain('may also exist on GitHub');
  });

  it('stores the App sealed, and status shows it without a secret', async () => {
    const { done } = await setUpApp();
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ configured: true, slug: 'acme-axiom', installations: [] });
    expect(done.body.installUrl).toBe('https://github.com/apps/acme-axiom/installations/new');

    const raw = await prisma.githubApp.findUniqueOrThrow({ where: { id: 1 } });
    expect(raw.createdById).toBe(admin.id);
    for (const sealed of [raw.clientSecret, raw.privateKey, raw.webhookSecret]) {
      expect(sealed.startsWith('enc:v1:')).toBe(true);
    }
    const secrets = await getGithubAppSecrets();
    expect(secrets).toMatchObject({
      appId: 1201,
      clientSecret: FIXTURE.client_secret,
      webhookSecret: FIXTURE.webhook_secret,
    });
    expect(secrets!.privateKey).toContain('PRIVATE KEY');

    const status = await request(app).get(BASE).set(as(member));
    expect(status.status).toBe(200);
    expect(status.body.configured).toBe(true);
  });

  it('lets the stored key sign as the App against the fake', async () => {
    await setUpApp();
    fake.addInstallation(4101, ['acme-labs/widget']);
    const res = await githubRequest<Array<{ id: number }>>(
      { kind: 'app' },
      'GET',
      '/app/installations',
    );
    expect(res.data.map((i) => i.id)).toEqual([4101]);
    expect(fake.requests.at(-1)?.headers.authorization).toBe('app');
  });

  it('never puts a secret in an answer, an audit row or a log line', async () => {
    const logs: string[] = [];
    const { logger } = await import('../../utils/logger');
    for (const level of ['info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(logger, level).mockImplementation((...args: unknown[]) => {
        logs.push(JSON.stringify(args));
        return logger;
      });
    }
    const answers: string[] = [];
    const started = await post(`${BASE}/manifest`, admin);
    answers.push(JSON.stringify(started.body));
    const code = fake.issueManifestCode();
    const done = await post(`${BASE}/manifest/complete`, admin, {
      code,
      state: started.body.state,
    });
    answers.push(JSON.stringify(done.body));
    // The same call again fails, and so does a bad code: errors hold no secret either
    const again = await post(`${BASE}/manifest/complete`, admin, {
      code,
      state: started.body.state,
    });
    answers.push(JSON.stringify(again.body));
    fake.addInstallation(4101, ['acme-labs/widget']);
    answers.push(JSON.stringify((await post(`${BASE}/installations/sync`, admin)).body));
    answers.push(JSON.stringify((await request(app).get(BASE).set(as(admin))).body));
    const secrets = (await getGithubAppSecrets())!;
    // The answer of every action, by name, over the registry as well as REST
    for (const name of ['githubApp.status', 'githubApp.syncInstallations']) {
      const res = await request(app)
        .post('/api/act')
        .set(as(admin))
        .send({ action: name, input: {} });
      answers.push(JSON.stringify(res.body));
    }
    const deleted = await request(app).delete(BASE).set(as(admin));
    answers.push(JSON.stringify(deleted.body));
    answers.push(
      await getAction('githubApp.delete')!.preview!({ userId: admin.id } as never, {}).catch(
        (e: Error) => e.message,
      ),
    );

    const audits = JSON.stringify(await prisma.auditLog.findMany({ where: { userId: admin.id } }));
    const haystack = [...answers, audits, ...logs].join('\n');
    const pemBody = secrets.privateKey.split('\n')[1];
    for (const secret of [secrets.clientSecret, secrets.webhookSecret, pemBody, 'PRIVATE KEY']) {
      expect(haystack).not.toContain(secret);
    }
  });

  it.each([
    ['one that was already used', 'used'],
    ['one that expired', 'expired'],
    ['one that belongs to someone else', 'foreign'],
    ['one that never existed', 'unknown'],
  ])('refuses %s, and makes no call to GitHub', async (_label, kind) => {
    const started = await post(`${BASE}/manifest`, admin);
    let state: string = started.body.state;
    if (kind === 'used') {
      await prisma.githubSetupState.delete({ where: { state } });
    } else if (kind === 'expired') {
      await prisma.githubSetupState.update({
        where: { state },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
    } else if (kind === 'unknown') {
      state = 'no-such-state';
    }
    const caller = kind === 'foreign' ? other : admin;
    fake.requests.length = 0;
    const res = await post(`${BASE}/manifest/complete`, caller, {
      code: fake.issueManifestCode(),
      state,
    });
    expect(res.status).toBe(400);
    expect(fake.requests).toHaveLength(0);
    expect(await prisma.githubApp.count()).toBe(0);
    // A foreign attempt leaves the owner's state alone
    if (kind === 'foreign') expect(await prisma.githubSetupState.count()).toBe(1);
  });

  it('spends the state: a second complete with it fails', async () => {
    const started = await post(`${BASE}/manifest`, admin);
    const first = await post(`${BASE}/manifest/complete`, admin, {
      code: fake.issueManifestCode(),
      state: started.body.state,
    });
    expect(first.status).toBe(200);
    await prisma.githubApp.deleteMany();
    fake.requests.length = 0;
    const second = await post(`${BASE}/manifest/complete`, admin, {
      code: fake.issueManifestCode(),
      state: started.body.state,
    });
    expect(second.status).toBe(400);
    expect(fake.requests).toHaveLength(0);
  });

  it('lets only one of two concurrent completes pass', async () => {
    const started = await post(`${BASE}/manifest`, admin);
    const results = await Promise.all(
      [0, 1, 2, 3].map(() =>
        post(`${BASE}/manifest/complete`, admin, {
          code: fake.issueManifestCode(),
          state: started.body.state,
        }),
      ),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 400)).toHaveLength(3);
    expect(fake.requests.filter((r) => r.path.endsWith('/conversions'))).toHaveLength(1);
    expect(await prisma.githubApp.count()).toBe(1);
  });

  it('is refused to a person who is not a platform admin', async () => {
    const res = await post(`${BASE}/manifest/complete`, member, { code: 'abc', state: 'x' });
    expect(res.status).toBe(403);
  });

  it('answers a refused code from GitHub without storing anything', async () => {
    const started = await post(`${BASE}/manifest`, admin);
    const res = await post(`${BASE}/manifest/complete`, admin, {
      code: 'a-code-github-never-issued',
      state: started.body.state,
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await prisma.githubApp.count()).toBe(0);
  });
});

describe('the status', () => {
  it('says not configured before any App is stored', async () => {
    const res = await request(app).get(BASE).set(as(member));
    expect(res.body).toEqual({ configured: false, installations: [] });
  });

  it('is open to a token with github:read, and to none without it', async () => {
    await seedGithubApp();
    const read = await tokenOf(member.id, ['github:read']);
    const ok = await request(app).get(BASE).set('Authorization', `Token ${read}`);
    expect(ok.status).toBe(200);
    expect(ok.body.configured).toBe(true);
    const wrong = await tokenOf(member.id, ['issues:read']);
    const no = await request(app).get(BASE).set('Authorization', `Token ${wrong}`);
    expect(no.status).toBe(403);
  });

  it('is listed in token-reach with the five actions', () => {
    const reach = JSON.parse(
      readFileSync(path.join(__dirname, '../../actions/token-reach.json'), 'utf8'),
    ) as Record<string, string[]>;
    expect(reach['githubApp.status']).toEqual(['github:read', 'github:write']);
    for (const name of [
      'githubApp.startManifest',
      'githubApp.completeManifest',
      'githubApp.syncInstallations',
      'githubApp.delete',
    ]) {
      expect(reach[name]).toEqual([]);
    }
  });
});

describe('installation tokens', () => {
  const posts = () =>
    fake.requests.filter((r) => r.method === 'POST' && r.path.endsWith('/access_tokens'));

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-06T10:00:00Z'));
  });

  it('fetches once for two calls, and again once the token is near its end', async () => {
    await seedGithubApp({ fake });
    fake.addInstallation(4101, ['acme-labs/widget']);
    const auth = { kind: 'installation', installationId: 4101 } as const;
    const call = () => githubRequest<unknown>(auth, 'GET', '/repos/acme-labs/widget');

    expect((await call()).status).toBe(200);
    expect((await call()).status).toBe(200);
    expect(posts()).toHaveLength(1);
    expect(fake.requests.at(-1)?.headers.authorization).toBe('installation:4101');

    // Valid for an hour, replaced 5 minutes before: still cached at 54 minutes
    vi.setSystemTime(new Date('2026-11-06T10:54:00Z'));
    await call();
    expect(posts()).toHaveLength(1);

    vi.setSystemTime(new Date('2026-11-06T10:56:00Z'));
    expect((await call()).status).toBe(200);
    expect(posts()).toHaveLength(2);
  });

  it('shares one request between calls made at the same time', async () => {
    await seedGithubApp({ fake });
    fake.addInstallation(4102, ['acme-labs/widget']);
    const auth = { kind: 'installation', installationId: 4102 } as const;
    await Promise.all(
      [1, 2, 3].map(() => githubRequest<unknown>(auth, 'GET', '/repos/acme-labs/widget')),
    );
    expect(posts()).toHaveLength(1);
  });

  it('does not cache a token whose fetch finishes after the App was forgotten', async () => {
    await seedGithubApp({ fake });
    fake.addInstallation(4103, ['acme-labs/widget']);
    const slowToken = fake.issueInstallationToken(4103);
    fake.on('POST /app/installations/:id/access_tokens', {
      status: 201,
      delayMs: 300,
      body: { token: slowToken, expires_at: new Date(Date.now() + 3_600_000).toISOString() },
    });
    const auth = { kind: 'installation', installationId: 4103 } as const;
    const inFlight = githubRequest<unknown>(auth, 'GET', '/repos/acme-labs/widget');
    await new Promise((resolve) => setTimeout(resolve, 100));
    await deleteApp();
    await inFlight;
    // Nothing of the forgotten App is served: not from the cache, not from a shared fetch
    await expect(githubRequest(auth, 'GET', '/repos/acme-labs/widget')).rejects.toMatchObject({
      statusCode: 409,
    });
    // And not for the App that replaces it
    await seedGithubApp({ fake });
    fake.reset();
    fake.addInstallation(4103, ['acme-labs/widget']);
    expect((await githubRequest(auth, 'GET', '/repos/acme-labs/widget')).status).toBe(200);
    expect(posts()).toHaveLength(1);
  });

  it('drops a cached token when the App row is replaced behind this process', async () => {
    await seedGithubApp({ fake });
    fake.addInstallation(4104, ['acme-labs/widget']);
    const auth = { kind: 'installation', installationId: 4104 } as const;
    await githubRequest(auth, 'GET', '/repos/acme-labs/widget');
    await githubRequest(auth, 'GET', '/repos/acme-labs/widget');
    expect(posts()).toHaveLength(1);
    // Another replica deleted the App and set up a new one: this process cleared nothing
    await prisma.githubApp.deleteMany();
    await expect(githubRequest(auth, 'GET', '/repos/acme-labs/widget')).rejects.toMatchObject({
      statusCode: 409,
    });
    vi.setSystemTime(new Date('2026-11-06T10:00:01Z'));
    await seedGithubApp({ fake, appId: 1201 });
    await githubRequest(auth, 'GET', '/repos/acme-labs/widget');
    expect(posts()).toHaveLength(2);
  });

  it('refuses an App call when none is set up', async () => {
    await expect(githubRequest({ kind: 'app' }, 'GET', '/app/installations')).rejects.toMatchObject(
      {
        statusCode: 409,
      },
    );
  });
});

describe('syncing installations', () => {
  it('upserts what GitHub lists and marks one that vanished as suspended', async () => {
    await seedGithubApp({ fake });
    fake.addInstallation(4101, ['acme-labs/widget']);
    fake.addInstallation(4102, ['octo-dev/notes'], { login: 'octo-dev', type: 'User' });
    const first = await post(`${BASE}/installations/sync`, admin);
    expect(first.status).toBe(200);
    expect(first.body.installations).toEqual([
      { id: 4101, accountLogin: 'acme-labs', suspended: false },
      { id: 4102, accountLogin: 'octo-dev', suspended: false },
    ]);
    expect(
      (await prisma.githubInstallation.findUniqueOrThrow({ where: { id: 4102 } })).accountType,
    ).toBe('User');

    const firstSync = (await prisma.githubInstallation.findUniqueOrThrow({ where: { id: 4102 } }))
      .lastEventAt;
    expect(firstSync).not.toBeNull();
    fake.removeInstallation(4102);
    const second = await post(`${BASE}/installations/sync`, admin);
    // Marking it gone is as fresh as the sync: a late older webhook event cannot undo it
    const gone = await prisma.githubInstallation.findUniqueOrThrow({ where: { id: 4102 } });
    expect(gone.lastEventAt!.getTime()).toBeGreaterThan(firstSync!.getTime());
    expect(second.body.installations).toEqual([
      { id: 4101, accountLogin: 'acme-labs', suspended: false },
      { id: 4102, accountLogin: 'octo-dev', suspended: true },
    ]);
    const status = await request(app).get(BASE).set(as(member));
    expect(status.body.installations).toHaveLength(2);
  });

  it('follows GitHub suspending an installation and lifting it again', async () => {
    await seedGithubApp({ fake });
    fake.addInstallation(4101, ['acme-labs/widget']);
    try {
      fake.suspendInstallation(4101);
      const suspended = await post(`${BASE}/installations/sync`, admin);
      expect(suspended.body.installations).toEqual([
        { id: 4101, accountLogin: 'acme-labs', suspended: true },
      ]);
    } finally {
      fake.suspendInstallation(4101, false);
    }
    const active = await post(`${BASE}/installations/sync`, admin);
    expect(active.body.installations).toEqual([
      { id: 4101, accountLogin: 'acme-labs', suspended: false },
    ]);
  });

  it('is refused to a person who is not a platform admin, and answers 409 with no App', async () => {
    expect((await post(`${BASE}/installations/sync`, member)).status).toBe(403);
    const res = await post(`${BASE}/installations/sync`, admin);
    expect(res.status).toBe(409);
  });
});

describe('starting the manifest in production', () => {
  const original = { env: process.env.NODE_ENV, front: process.env.FRONTEND_URL };
  afterEach(() => {
    vi.stubEnv('NODE_ENV', original.env ?? 'test');
    if (original.front === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = original.front;
    vi.unstubAllEnvs();
  });

  it.each([[undefined], ['http://axiom.acme.test'], ['not a url']])(
    'refuses with 409 when FRONTEND_URL is %s',
    async (front) => {
      vi.stubEnv('NODE_ENV', 'production');
      if (front === undefined) delete process.env.FRONTEND_URL;
      else process.env.FRONTEND_URL = front;
      const res = await post(`${BASE}/manifest`, admin);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('GITHUB_FRONTEND_URL_REQUIRED');
      expect(res.body.error.message).toContain('FRONTEND_URL');
      expect(await prisma.githubSetupState.count({ where: { userId: admin.id } })).toBe(0);
    },
  );

  it('starts with an https FRONTEND_URL', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    process.env.FRONTEND_URL = 'https://axiom.acme.test';
    const res = await post(`${BASE}/manifest`, admin);
    expect(res.status).toBe(200);
    expect(res.body.manifest.hook_attributes.url).toBe(
      'https://axiom.acme.test/api/github/webhook',
    );
  });
});

describe('forgetting the App', () => {
  it('deletes the App and its installations, and says GitHub still has it', async () => {
    await seedGithubApp({ fake });
    await prisma.githubInstallation.create({
      data: { id: 4101, accountLogin: 'acme-labs', accountType: 'Organization' },
    });
    const def = getAction('githubApp.delete')!;
    expect(def.destructive).toBe(true);
    expect(await def.preview!({ userId: admin.id } as never, {})).toBe(
      'Forget the GitHub App acme-axiom: webhooks stop and every connected GitHub account is disconnected',
    );

    expect((await request(app).delete(BASE).set(as(member))).status).toBe(403);
    expect(await prisma.githubApp.count()).toBe(1);

    fake.requests.length = 0;
    const res = await request(app).delete(BASE).set(as(admin));
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);
    expect(res.body.note).toContain('still exists on GitHub');
    expect(await prisma.githubApp.count()).toBe(0);
    expect(await prisma.githubInstallation.count()).toBe(0);
    expect(fake.requests).toHaveLength(0);
    expect((await request(app).delete(BASE).set(as(admin))).status).toBe(404);
  });
});
