import { generateKeyPairSync, verify } from 'node:crypto';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '../../middleware/errorHandler';
import { useGithubFake } from '../../test/github-fake';
import { logger } from '../../utils/logger';

import {
  githubPaginate,
  githubRequest,
  githubText,
  githubWebUrl,
  registerGithubAuthResolver,
  setGithubBaseUrls,
} from './github-client';
import { appJwt } from './github-jwt';

const fake = useGithubFake();
const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
const INSTALLATION = { kind: 'installation', installationId: 4101 } as const;
let installationToken = '';
let userToken = '';

beforeAll(() => {
  fake.setApp({ appId: 1201, publicKey });
  fake.addInstallation(4101, ['acme-labs/widget', 'acme-labs/gadget']);
  fake.addInstallation(4102, ['acme-labs/gadget']);
  fake.setPublicRepos(['acme-labs/gadget']);
  installationToken = fake.issueInstallationToken(INSTALLATION.installationId);
  userToken = fake.issueUserToken('octo-dev', ['acme-labs/widget']);
  registerGithubAuthResolver('app', async () => `Bearer ${appJwt(1201, privateKey)}`);
  registerGithubAuthResolver('installation', async () => `token ${installationToken}`);
  registerGithubAuthResolver('user', async () => `token ${userToken}`);
});

// Failed calls log a warning by design; keep the test output quiet
beforeEach(() => {
  vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function thrown(promise: Promise<unknown>): Promise<AppError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  return error as AppError;
}

describe('githubRequest', () => {
  it('returns typed data and sends the GitHub media type and API version', async () => {
    const { status, data } = await githubRequest<{ full_name: string; private: boolean }>(
      INSTALLATION,
      'GET',
      '/repos/acme-labs/widget',
    );

    expect(status).toBe(200);
    expect(data.full_name).toBe('acme-labs/widget');
    const [sent] = fake.requests;
    expect(sent.headers.accept).toBe('application/vnd.github+json');
    expect(sent.headers['x-github-api-version']).toBe('2022-11-28');
    expect(sent.headers.authorization).toBe(`installation:${INSTALLATION.installationId}`);
  });

  it('signs App calls with a JWT the fake verifies', async () => {
    const { data } = await githubRequest<{ slug: string }>({ kind: 'app' }, 'GET', '/app');

    expect(data.slug).toBe('acme-axiom');
    expect(fake.requests[0].headers.authorization).toBe('app');
  });

  it('sends the query and a JSON body', async () => {
    fake.on('POST /repos/:owner/:repo/pulls', (req) => ({
      status: 201,
      body: { number: 7, title: (req.body as { title: string }).title },
    }));

    const { status, data } = await githubRequest<{ number: number; title: string }>(
      { kind: 'user', userId: 'u1' },
      'POST',
      '/repos/acme-labs/widget/pulls',
      { body: { title: 'Add the widget', head: 'feature', base: 'main' }, query: { draft: 1 } },
    );

    expect(status).toBe(201);
    expect(data).toEqual({ number: 7, title: 'Add the widget' });
    expect(fake.requests[0].query).toEqual({ draft: '1' });
    expect(fake.requests[0].headers.authorization).toMatch(/^user:ghu_/);
  });

  it('answers a route the fake does not know with 404, and records the call', async () => {
    const error = await thrown(
      githubRequest(INSTALLATION, 'GET', '/repos/acme-labs/widget/hooks/99'),
    );

    expect(error.statusCode).toBe(404);
    expect(error.code).toBe('GITHUB_NOT_FOUND');
    expect(fake.requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      'GET /repos/acme-labs/widget/hooks/99',
    ]);
  });

  it('maps 403 to GITHUB_FORBIDDEN', async () => {
    fake.on('GET /repos/acme-labs/widget', {
      status: 403,
      body: { message: 'Resource not accessible by integration' },
    });

    const error = await thrown(githubRequest(INSTALLATION, 'GET', '/repos/acme-labs/widget'));

    expect([error.statusCode, error.code]).toEqual([403, 'GITHUB_FORBIDDEN']);
  });

  it('maps 409 to GITHUB_CONFLICT', async () => {
    fake.on('PUT /repos/acme-labs/widget/pulls/7/merge', {
      status: 409,
      body: { message: 'Head branch was modified. Review and try the merge again.' },
    });

    const error = await thrown(
      githubRequest(INSTALLATION, 'PUT', '/repos/acme-labs/widget/pulls/7/merge'),
    );

    expect([error.statusCode, error.code]).toEqual([409, 'GITHUB_CONFLICT']);
    expect(error.message).toContain('Head branch was modified');
  });

  it("maps 422 to GITHUB_INVALID with GitHub's message", async () => {
    fake.on('POST /repos/acme-labs/widget/pulls', {
      status: 422,
      body: {
        message: 'Validation Failed',
        errors: [
          {
            resource: 'PullRequest',
            code: 'custom',
            message: 'No commits between main and feature',
          },
        ],
      },
    });

    const error = await thrown(
      githubRequest(INSTALLATION, 'POST', '/repos/acme-labs/widget/pulls', { body: {} }),
    );

    expect([error.statusCode, error.code]).toEqual([422, 'GITHUB_INVALID']);
    expect(error.message).toContain('Validation Failed');
    expect(error.message).toContain('No commits between main and feature');
  });

  it('maps 429 to GITHUB_RATE_LIMITED with retry-after', async () => {
    fake.on('GET /repos/acme-labs/widget', {
      status: 429,
      body: { message: 'Too many requests' },
      headers: { 'retry-after': '7' },
    });

    const error = await thrown(githubRequest(INSTALLATION, 'GET', '/repos/acme-labs/widget'));

    expect([error.statusCode, error.code]).toEqual([503, 'GITHUB_RATE_LIMITED']);
    expect(error.details).toEqual({ retryAfterSeconds: 7 });
  });

  it('maps a 403 with no requests left to GITHUB_RATE_LIMITED, retrying at the reset time', async () => {
    const reset = Math.floor(Date.now() / 1000) + 120;
    fake.on('GET /repos/acme-labs/widget', {
      status: 403,
      body: { message: 'API rate limit exceeded for installation ID 4101.' },
      headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) },
    });

    const error = await thrown(githubRequest(INSTALLATION, 'GET', '/repos/acme-labs/widget'));

    expect(error.code).toBe('GITHUB_RATE_LIMITED');
    const seconds = error.details?.retryAfterSeconds as number;
    expect(seconds).toBeGreaterThanOrEqual(118);
    expect(seconds).toBeLessThanOrEqual(121);
  });

  it('maps a secondary rate limit to GITHUB_RATE_LIMITED', async () => {
    fake.on('GET /repos/acme-labs/widget', {
      status: 403,
      body: { message: 'You have exceeded a secondary rate limit. Please wait a few minutes.' },
    });

    const error = await thrown(githubRequest(INSTALLATION, 'GET', '/repos/acme-labs/widget'));

    expect(error.code).toBe('GITHUB_RATE_LIMITED');
    expect(error.details?.retryAfterSeconds).toBe(60);
  });

  it('maps 401 to GITHUB_RECONNECT for a user and GITHUB_APP_AUTH for the App', async () => {
    fake.on('GET /repos/acme-labs/widget', { status: 401, body: { message: 'Bad credentials' } });

    const asUser = await thrown(
      githubRequest({ kind: 'user', userId: 'u1' }, 'GET', '/repos/acme-labs/widget'),
    );
    const asInstallation = await thrown(
      githubRequest(INSTALLATION, 'GET', '/repos/acme-labs/widget'),
    );

    expect([asUser.statusCode, asUser.code]).toEqual([409, 'GITHUB_RECONNECT']);
    expect([asInstallation.statusCode, asInstallation.code]).toEqual([502, 'GITHUB_APP_AUTH']);
  });

  it('refuses a token it did not issue with 401, as GitHub does', async () => {
    registerGithubAuthResolver('user', async () => 'token ghu_notIssuedByTheFake0000000000000000');
    try {
      const error = await thrown(githubRequest({ kind: 'user', userId: 'u1' }, 'GET', '/user'));
      expect(error.code).toBe('GITHUB_RECONNECT');
      expect(fake.requests[0].headers.authorization).toBe('invalid');
    } finally {
      registerGithubAuthResolver('user', async () => `token ${userToken}`);
    }
  });

  it('gives GITHUB_UNAVAILABLE when GitHub does not answer within the timeout', async () => {
    fake.on('GET /repos/acme-labs/widget', { status: 200, body: {}, delayMs: 500 });

    const error = await thrown(
      githubRequest(INSTALLATION, 'GET', '/repos/acme-labs/widget', { timeoutMs: 50 }),
    );

    expect([error.statusCode, error.code]).toEqual([502, 'GITHUB_UNAVAILABLE']);
  });

  it('gives GITHUB_UNAVAILABLE when GitHub cannot be reached', async () => {
    setGithubBaseUrls({ api: 'http://127.0.0.1:1', web: 'http://127.0.0.1:1/web' });
    try {
      const error = await thrown(githubRequest(INSTALLATION, 'GET', '/repos/acme-labs/widget'));
      expect([error.statusCode, error.code]).toEqual([502, 'GITHUB_UNAVAILABLE']);
    } finally {
      setGithubBaseUrls({ api: fake.url, web: `${fake.url}/web` });
    }
  });

  it('keeps the token out of the thrown error and the log when GitHub echoes it', async () => {
    const echo = (req: { headers: Record<string, string> }) => ({
      status: 422,
      body: {
        message: `Validation Failed for token ${installationToken} (sent as ${req.headers.authorization})`,
        errors: [{ message: `token ${installationToken} is not allowed here` }],
        documentation_url: `https://docs.github.com/rest?token=${installationToken}`,
      },
    });
    fake.on('POST /repos/acme-labs/widget/issues', echo);
    fake.on('GET /repos/acme-labs/widget', {
      status: 403,
      body: { message: `Forbidden for Bearer ${installationToken}` },
    });
    const logged: unknown[] = [];
    for (const level of ['debug', 'info', 'warn', 'error'] as const) {
      vi.spyOn(logger, level).mockImplementation((...args: unknown[]) => {
        logged.push(args);
      });
    }

    const invalid = await thrown(
      githubRequest(INSTALLATION, 'POST', '/repos/acme-labs/widget/issues', { body: {} }),
    );
    const forbidden = await thrown(githubRequest(INSTALLATION, 'GET', '/repos/acme-labs/widget'));

    expect(invalid.code).toBe('GITHUB_INVALID');
    expect(invalid.message).toContain('Validation Failed');
    for (const error of [invalid, forbidden]) {
      const everything = JSON.stringify({
        message: error.message,
        details: error.details,
        stack: error.stack,
        cause: String(error.cause ?? ''),
      });
      expect(everything).not.toContain(installationToken);
      expect(everything).not.toContain(installationToken.slice(4));
    }
    expect(logged.length).toBeGreaterThan(0);
    const log = JSON.stringify(logged);
    expect(log).not.toContain(installationToken);
    expect(log).not.toMatch(/authorization/i);
    expect(log).toContain('/repos/acme-labs/widget/issues');
  });

  it('logs method, path and status only', async () => {
    const debug = vi.spyOn(logger, 'debug').mockImplementation(() => undefined);

    await githubRequest(INSTALLATION, 'GET', '/repos/acme-labs/widget', { query: { ref: 'main' } });

    expect(debug).toHaveBeenCalledWith('github request', {
      method: 'GET',
      path: '/repos/acme-labs/widget',
      status: 200,
    });
  });
});

describe('githubPaginate', () => {
  function pagedIssues(pages: number) {
    fake.on('GET /repos/:owner/:repo/issues', (req) => {
      const page = Number(req.query.page ?? 1);
      const next =
        page < pages ? `<${fake.url}${req.path}?per_page=100&page=${page + 1}>; rel="next"` : '';
      return {
        status: 200,
        body: [{ number: page * 10 + 1 }, { number: page * 10 + 2 }],
        headers: next
          ? { link: `${next}, <${fake.url}${req.path}?page=${pages}>; rel="last"` }
          : {},
      };
    });
  }

  it('follows rel="next" with per_page=100 until the last page', async () => {
    pagedIssues(3);

    const { items, complete } = await githubPaginate<{ number: number }>(
      INSTALLATION,
      '/repos/acme-labs/widget/issues',
      { maxPages: 5, query: { state: 'open' } },
    );

    expect(complete).toBe(true);
    expect(items.map((i) => i.number)).toEqual([11, 12, 21, 22, 31, 32]);
    expect(fake.requests[0].query).toEqual({ state: 'open', per_page: '100' });
    expect(fake.requests).toHaveLength(3);
  });

  it('stops at maxPages and says the list is incomplete', async () => {
    pagedIssues(5);

    const { items, complete } = await githubPaginate<{ number: number }>(
      INSTALLATION,
      '/repos/acme-labs/widget/issues',
      { maxPages: 2 },
    );

    expect(complete).toBe(false);
    expect(items).toHaveLength(4);
    expect(fake.requests).toHaveLength(2);
  });

  it('reads the items from itemsKey for wrapped lists', async () => {
    const { items, complete } = await githubPaginate<{ full_name: string }>(
      INSTALLATION,
      '/installation/repositories',
      { maxPages: 1, itemsKey: 'repositories' },
    );

    expect(complete).toBe(true);
    expect(items.map((r) => r.full_name)).toEqual(['acme-labs/widget', 'acme-labs/gadget']);
  });
});

describe('githubText', () => {
  it('follows the redirect without the Authorization header and keeps the last maxBytes', async () => {
    const log = Array.from({ length: 2000 }, (_, i) => `line ${i}`).join('\n');
    fake.on('GET /repos/acme-labs/widget/actions/jobs/1/logs', {
      status: 302,
      headers: { location: `${fake.url}/web/logs/1` },
    });
    fake.on('GET /web/logs/1', {
      status: 200,
      body: log,
      headers: { 'content-type': 'text/plain' },
    });

    const text = await githubText(INSTALLATION, '/repos/acme-labs/widget/actions/jobs/1/logs', 64);

    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(64);
    expect(log.endsWith(text)).toBe(true);
    expect(text.endsWith('line 1999')).toBe(true);
    const [api, redirected] = fake.requests;
    expect(api.headers.authorization).toBe(`installation:${INSTALLATION.installationId}`);
    expect(redirected.path).toBe('/web/logs/1');
    expect(redirected.headers.authorization).toBeUndefined();
  });

  it('never sends the token back to the API host after the chain left it', async () => {
    fake.on('GET /repos/acme-labs/widget/actions/jobs/3/logs', {
      status: 302,
      headers: { location: `${fake.url.replace('127.0.0.1', 'localhost')}/web/hop` },
    });
    // The storage host sends the download on to the API host
    fake.on('GET /web/hop', {
      status: 302,
      headers: { location: `${fake.url}/repos/acme-labs/gadget` },
    });

    const text = await githubText(
      INSTALLATION,
      '/repos/acme-labs/widget/actions/jobs/3/logs',
      4096,
    );

    expect(text).toContain('full_name');
    const back = fake.requests.find((r) => r.path === '/repos/acme-labs/gadget');
    expect(back).toBeDefined();
    expect(back!.headers.authorization).toBeUndefined();
  });

  it('reads no more than 64 KB of an error body', async () => {
    fake.on('GET /repos/acme-labs/widget/actions/jobs/5/logs', {
      status: 500,
      body: 'x'.repeat(2_000_000),
    });

    const error = await thrown(
      githubText(INSTALLATION, '/repos/acme-labs/widget/actions/jobs/5/logs', 64),
    );

    expect(error.code).toBe('GITHUB_UNAVAILABLE');
  });

  it('maps an expired resource (410) to its own code', async () => {
    fake.on('GET /repos/acme-labs/widget/actions/jobs/6/logs', {
      status: 410,
      body: { message: 'Logs expired' },
    });

    const error = await thrown(
      githubText(INSTALLATION, '/repos/acme-labs/widget/actions/jobs/6/logs', 64),
    );

    expect([error.statusCode, error.code]).toEqual([410, 'GITHUB_GONE']);
  });

  it('maps an error answer like any other call', async () => {
    const error = await thrown(
      githubText(INSTALLATION, '/repos/acme-labs/widget/actions/jobs/2/logs', 64),
    );

    expect(error.code).toBe('GITHUB_NOT_FOUND');
  });
});

describe('githubWebUrl', () => {
  it('builds a URL on the web host', () => {
    expect(githubWebUrl('/acme-labs/widget/pull/7')).toBe(
      `${fake.url}/web/acme-labs/widget/pull/7`,
    );
  });
});

describe('appJwt', () => {
  it('signs RS256 with iat a minute back, a ten minute window and the App id as issuer', () => {
    const now = new Date('2026-11-06T12:00:00Z');
    const token = appJwt(1201, privateKey, now);
    const [header, payload, signature] = token.split('.');

    const valid = verify(
      'sha256',
      Buffer.from(`${header}.${payload}`),
      publicKey,
      Buffer.from(signature, 'base64url'),
    );
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());

    expect(valid).toBe(true);
    expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual({
      alg: 'RS256',
      typ: 'JWT',
    });
    expect(claims.iss).toBe(1201);
    expect(claims.iat).toBe(now.getTime() / 1000 - 60);
    expect(claims.exp - claims.iat).toBe(600);
  });

  it('does not verify with another key', () => {
    const other = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    const [header, payload, signature] = appJwt(1201, other.privateKey).split('.');

    expect(
      verify(
        'sha256',
        Buffer.from(`${header}.${payload}`),
        publicKey,
        Buffer.from(signature, 'base64url'),
      ),
    ).toBe(false);
  });
});

describe('the fake', () => {
  it('refuses an App call signed by another key', async () => {
    const other = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    registerGithubAuthResolver('app', async () => `Bearer ${appJwt(1201, other.privateKey)}`);
    try {
      const error = await thrown(githubRequest({ kind: 'app' }, 'GET', '/app'));
      expect(error.code).toBe('GITHUB_APP_AUTH');
    } finally {
      registerGithubAuthResolver('app', async () => `Bearer ${appJwt(1201, privateKey)}`);
    }
  });

  it('issues an installation token to the App and scopes it to that installation', async () => {
    const { data } = await githubRequest<{ token: string; expires_at: string }>(
      { kind: 'app' },
      'POST',
      '/app/installations/4102/access_tokens',
    );
    expect(data.token).toMatch(/^ghs_/);

    registerGithubAuthResolver('installation', async () => `token ${data.token}`);
    try {
      const auth = { kind: 'installation', installationId: 4102 } as const;
      await githubRequest(auth, 'GET', '/repos/acme-labs/gadget');
      expect(fake.requests[1].headers.authorization).toBe('installation:4102');

      // A private repository outside the installation is invisible, as on GitHub
      const outside = await thrown(githubRequest(auth, 'GET', '/repos/acme-labs/widget'));
      expect(outside.code).toBe('GITHUB_NOT_FOUND');
      // Writing there is no different
      const write = await thrown(
        githubRequest(auth, 'POST', '/repos/acme-labs/widget/issues', { body: {} }),
      );
      expect(write.code).toBe('GITHUB_NOT_FOUND');

      const { items } = await githubPaginate<{ full_name: string }>(
        auth,
        '/installation/repositories',
        { maxPages: 1, itemsKey: 'repositories' },
      );
      expect(items.map((r) => r.full_name)).toEqual(['acme-labs/gadget']);
    } finally {
      registerGithubAuthResolver('installation', async () => `token ${installationToken}`);
    }
  });

  it('refuses writes to a public repository the token cannot reach', async () => {
    const userAuth = { kind: 'user', userId: 'u1' } as const;
    const { data } = await githubRequest<{ full_name: string }>(
      userAuth,
      'GET',
      '/repos/acme-labs/gadget',
    );
    expect(data.full_name).toBe('acme-labs/widget'); // the fixture body serves every repo

    const error = await thrown(
      githubRequest(userAuth, 'POST', '/repos/acme-labs/gadget/issues', { body: {} }),
    );
    expect([error.statusCode, error.code]).toEqual([403, 'GITHUB_FORBIDDEN']);
  });

  it('answers 404 for an installation it does not have', async () => {
    const error = await thrown(
      githubRequest({ kind: 'app' }, 'POST', '/app/installations/9999/access_tokens'),
    );

    expect(error.code).toBe('GITHUB_NOT_FOUND');
    expect(() => fake.issueInstallationToken(9999)).toThrow(/9999/);
  });

  it('refuses an App JWT whose issuer is another App', async () => {
    registerGithubAuthResolver('app', async () => `Bearer ${appJwt(1202, privateKey)}`);
    try {
      const error = await thrown(githubRequest({ kind: 'app' }, 'GET', '/app'));
      expect(error.code).toBe('GITHUB_APP_AUTH');
      expect(fake.requests[0].headers.authorization).toBe('invalid');
    } finally {
      registerGithubAuthResolver('app', async () => `Bearer ${appJwt(1201, privateKey)}`);
    }
  });

  it('answers calls without a credential as GitHub does', async () => {
    const none = { kind: 'none' } as const;

    const { data } = await githubRequest<{ full_name: string }>(
      none,
      'GET',
      '/repos/acme-labs/gadget',
    );
    const privateRepo = await thrown(githubRequest(none, 'GET', '/repos/acme-labs/widget'));
    const user = await thrown(githubRequest(none, 'GET', '/user'));
    const app = await thrown(githubRequest(none, 'GET', '/app'));

    expect(data.full_name).toBeDefined();
    expect(privateRepo.code).toBe('GITHUB_NOT_FOUND');
    expect(user.code).toBe('GITHUB_APP_AUTH');
    expect(app.code).toBe('GITHUB_APP_AUTH');
    expect(fake.requests.every((r) => r.headers.authorization === undefined)).toBe(true);
  });
});

describe('the credential stays on the API host', () => {
  let other: Server;
  let otherUrl = '';
  const seen: IncomingHttpHeaders[] = [];
  const bodies: string[] = [];
  // The other host's answer: 200 with an empty list unless a test sends it elsewhere
  let otherRedirect: { status: number; location: string } | null = null;

  beforeAll(async () => {
    other = createServer((req, res) => {
      seen.push(req.headers);
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        bodies.push(Buffer.concat(chunks).toString('utf8'));
        if (otherRedirect) {
          res.writeHead(otherRedirect.status, { location: otherRedirect.location });
          res.end();
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('[]');
      });
    });
    await new Promise<void>((resolve) => other.listen(0, '127.0.0.1', resolve));
    otherUrl = `http://127.0.0.1:${(other.address() as AddressInfo).port}`;
  });

  afterEach(() => {
    seen.length = 0;
    bodies.length = 0;
    otherRedirect = null;
  });

  it('never sends the token again once a redirect left the API host', async () => {
    fake.on('GET /repos/acme-labs/widget', {
      status: 302,
      headers: { location: `${otherUrl}/hop` },
    });
    // Back to a public repository, which answers without a token
    otherRedirect = { status: 307, location: `${fake.url}/repos/acme-labs/gadget/back` };
    fake.on('GET /repos/acme-labs/gadget/back', { status: 200, body: { back: true } });

    const { data } = await githubRequest<{ back: boolean }>(
      INSTALLATION,
      'GET',
      '/repos/acme-labs/widget',
    );

    expect(data).toEqual({ back: true });
    expect(seen).toHaveLength(1);
    expect(seen[0].authorization).toBeUndefined();
    const [first, last] = fake.requests;
    expect(first.headers.authorization).toBe(`installation:${INSTALLATION.installationId}`);
    expect(last.path).toBe('/repos/acme-labs/gadget/back');
    expect(last.headers.authorization).toBeUndefined();
  });

  it.each([307, 308])('refuses a %i to another host, so the body stays home', async (status) => {
    fake.on('POST /repos/acme-labs/widget/issues', {
      status,
      headers: { location: `${otherUrl}/issues` },
    });

    const error = await thrown(
      githubRequest(INSTALLATION, 'POST', '/repos/acme-labs/widget/issues', {
        body: { title: 'Secret plans of acme-labs' },
      }),
    );

    expect(error.code).toBe('GITHUB_UNAVAILABLE');
    expect(error.message).toMatch(/another host/);
    expect(seen).toHaveLength(0);
    expect(bodies.join('')).not.toContain('Secret plans');
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => other.close(() => resolve()));
  });

  it('refuses an absolute URL as a path', async () => {
    await expect(
      githubRequest(INSTALLATION, 'GET', `${otherUrl}/repos/acme-labs/widget`),
    ).rejects.toThrow(/path/);
    await expect(githubText(INSTALLATION, `${otherUrl}/logs`, 64)).rejects.toThrow(/path/);

    expect(seen).toHaveLength(0);
  });

  it('refuses a path without a leading slash, which could name another host', async () => {
    const hostile = `@${otherUrl.slice('http://'.length)}/repos/acme-labs/widget`;

    await expect(githubRequest(INSTALLATION, 'GET', hostile)).rejects.toThrow(/path/);
    await expect(githubPaginate(INSTALLATION, hostile, { maxPages: 1 })).rejects.toThrow(/path/);

    expect(seen).toHaveLength(0);
    expect(fake.requests).toHaveLength(0);
  });

  it('follows a redirect to another host without the Authorization header', async () => {
    fake.on('GET /repos/acme-labs/widget', {
      status: 302,
      headers: { location: `${otherUrl}/elsewhere` },
    });

    await githubRequest(INSTALLATION, 'GET', '/repos/acme-labs/widget');

    expect(seen).toHaveLength(1);
    expect(seen[0].authorization).toBeUndefined();
  });

  it('refuses a next page on another host', async () => {
    fake.on('GET /repos/acme-labs/widget/issues', {
      status: 200,
      body: [{ number: 1 }],
      headers: { link: `<${otherUrl}/repos/acme-labs/widget/issues?page=2>; rel="next"` },
    });

    const error = await thrown(
      githubPaginate(INSTALLATION, '/repos/acme-labs/widget/issues', { maxPages: 3 }),
    );

    expect(error.code).toBe('GITHUB_UNAVAILABLE');
    expect(seen).toHaveLength(0);
  });

  it('githubWebUrl refuses a path without a leading slash', () => {
    expect(() => githubWebUrl('evil.example/acme-labs')).toThrow(/path/);
    expect(() => githubWebUrl('//evil.example/acme-labs')).toThrow(/path/);
    expect(() => githubWebUrl('@evil.example/acme-labs')).toThrow(/path/);
  });
});

describe('error details', () => {
  it('reads "bad credentials" as an auth failure only at 401 and 403', async () => {
    fake.on('POST /repos/acme-labs/widget/issues', {
      status: 422,
      body: { message: 'Bad credentials are not a valid label name' },
    });
    fake.on('GET /repos/acme-labs/widget', { status: 403, body: { message: 'Bad credentials' } });

    const invalid = await thrown(
      githubRequest(INSTALLATION, 'POST', '/repos/acme-labs/widget/issues', { body: {} }),
    );
    const forbidden = await thrown(githubRequest(INSTALLATION, 'GET', '/repos/acme-labs/widget'));

    expect(invalid.code).toBe('GITHUB_INVALID');
    expect(forbidden.code).toBe('GITHUB_APP_AUTH');
  });

  it('says so when an answer cannot be read', async () => {
    fake.on('GET /repos/acme-labs/widget', {
      status: 200,
      body: '{"full_name": "acme-labs/wid',
      headers: { 'content-type': 'application/json' },
    });

    const error = await thrown(githubRequest(INSTALLATION, 'GET', '/repos/acme-labs/widget'));

    expect(error.code).toBe('GITHUB_UNAVAILABLE');
    expect(error.message).toMatch(/could not be read/);
    expect(error.message).not.toMatch(/in time/);
  });
});
