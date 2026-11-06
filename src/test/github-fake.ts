/**
 * A recorded stand-in for GitHub, served over real HTTP on 127.0.0.1. It answers from the
 * fixtures in `__fixtures__/github/<scenario>/` (base first, the scenario on top), checks
 * credentials the way GitHub does, and records every request, unknown routes included.
 */
import { generateKeyPairSync, randomBytes, verify } from 'node:crypto';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';

import { afterAll, afterEach, beforeAll } from 'vitest';

import { setGithubBaseUrls } from '../modules/github/github-client';

export interface RecordedRequest {
  method: string;
  path: string;
  query: Record<string, string>;
  /** Lowercased; `authorization` holds its kind (`app`, `installation:<id>`, `user:<prefix>`) */
  headers: Record<string, string>;
  body: unknown;
}

export interface FakeReply {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
  /** Hold the answer back this long, to test timeouts */
  delayMs?: number;
}

type Handler = FakeReply | ((req: RecordedRequest, params: Record<string, string>) => FakeReply);

interface Route {
  method: string;
  segments: string[];
  handler: Handler;
}

export interface GithubFake {
  readonly url: string;
  readonly requests: RecordedRequest[];
  /** Answers a route, ahead of the fixtures, until `reset`. `route` as `'GET /repos/:owner/:repo'` */
  on(route: string, reply: Handler): void;
  /** The App: `/app/*` calls need a JWT issued by this id that verifies against this key */
  setApp(app: { appId: number; publicKey: string } | null): void;
  /**
   * An installation of the App and the repositories (`owner/name`) it was granted. The account
   * is the owner of the first repository unless given.
   */
  addInstallation(
    installationId: number,
    repos: string[],
    account?: { login: string; type: 'Organization' | 'User' },
  ): void;
  /** The installation is gone, as when the App is uninstalled; its tokens stop working */
  removeInstallation(installationId: number): void;
  /** A manifest code, as GitHub puts on the redirect; it converts once */
  issueManifestCode(): string;
  /** Repositories anyone may read, with or without a credential; every other one is private */
  setPublicRepos(repos: string[]): void;
  /** A `ghs_` token for an installation added before, reaching only that installation's repos */
  issueInstallationToken(installationId: number): string;
  /** A `ghu_` token for that user, reaching only the given repositories */
  issueUserToken(login: string, repos: string[]): string;
  /**
   * Installation tokens expire an hour after they are issued, by `Date.now()`, so a test that
   * fakes the clock (`vi.useFakeTimers({ toFake: ['Date'] })`) drives `expires_at` and the
   * fake's refusal of an expired token alike.
   */
  /** Forgets recorded requests and `on` routes; the App, installations and tokens stay */
  reset(): void;
  close(): Promise<void>;
}

const TOKEN_LIFETIME_MS = 60 * 60_000;
const FIXTURES = path.join(__dirname, '__fixtures__', 'github');

function parseRoute(route: string, handler: Handler): Route {
  const [method, routePath] = route.trim().split(/\s+/);
  if (!method || !routePath?.startsWith('/')) throw new Error(`Bad fake route: ${route}`);
  return { method: method.toUpperCase(), segments: routePath.split('/').slice(1), handler };
}

function loadFixtures(scenario: string): Route[] {
  const dir = path.join(FIXTURES, scenario);
  if (!existsSync(dir)) throw new Error(`No GitHub fixture scenario "${scenario}"`);
  return readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => {
      const fixture = JSON.parse(readFileSync(path.join(dir, file), 'utf8')) as {
        route: string;
        status: number;
        body?: unknown;
        headers?: Record<string, string>;
      };
      return parseRoute(fixture.route, {
        status: fixture.status,
        body: fixture.body,
        headers: fixture.headers,
      });
    });
}

function match(route: Route, method: string, segments: string[]): Record<string, string> | null {
  if (route.method !== method || route.segments.length !== segments.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < segments.length; i++) {
    const want = route.segments[i];
    if (want.startsWith(':')) params[want.slice(1)] = decodeURIComponent(segments[i]);
    else if (want !== segments[i]) return null;
  }
  return params;
}

/**
 * Literal segments win over `:param` ones, so `/repos/acme-labs/widget` beats `/repos/:o/:r`
 * @param route
 */
const paramCount = (route: Route) => route.segments.filter((s) => s.startsWith(':')).length;

/**
 * Verifies an RS256 JWT as GitHub does for an App: signature, algorithm, issuer and time window.
 * @param token The JWT
 * @param publicKeyPem The App's public key
 * @param appId The App's id, which must be the issuer
 */
export function verifyAppJwt(token: string, publicKeyPem: string, appId: number): boolean {
  const [header, payload, signature] = token.split('.');
  if (!header || !payload || !signature) return false;
  try {
    const head = JSON.parse(Buffer.from(header, 'base64url').toString()) as { alg?: string };
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as {
      iat?: number;
      exp?: number;
      iss?: unknown;
    };
    const now = Date.now() / 1000;
    if (head.alg !== 'RS256' || String(claims.iss) !== String(appId)) return false;
    if (typeof claims.exp !== 'number' || claims.exp <= now) return false;
    if (typeof claims.iat !== 'number' || claims.iat > now + 60) return false;
    if (claims.exp - claims.iat > 600) return false;
    return verify(
      'sha256',
      Buffer.from(`${header}.${payload}`),
      publicKeyPem,
      Buffer.from(signature, 'base64url'),
    );
  } catch {
    return false;
  }
}

const tokenOf = (prefix: string) => `${prefix}${randomBytes(27).toString('base64url')}`;
const repoKey = (fullName: string) => fullName.toLowerCase();

/** Who a request authenticated as, in the fake's eyes */
interface Credential {
  kind: 'none' | 'invalid' | 'basic' | 'app' | 'installation' | 'user';
  /** What the recorded `authorization` header says: `app`, `installation:<id>`, `user:<prefix>` */
  label?: string;
  installationId?: number;
  /** The repositories (lowercased `owner/name`) the credential reaches */
  repos?: Set<string>;
}

const reply = (status: number, message: string): FakeReply => ({ status, body: { message } });
const NOT_FOUND = reply(404, 'Not Found');
const REQUIRES_AUTH = reply(401, 'Requires authentication');
const NOT_ACCESSIBLE = reply(403, 'Resource not accessible by integration');

class GithubFakeServer implements GithubFake {
  readonly requests: RecordedRequest[] = [];
  private server: Server | null = null;
  private baseUrl = '';
  private overrides: Route[] = [];
  private fixtures: Route[] = [];
  private app: { appId: number; publicKey: string } | null = null;
  private installations = new Map<number, Set<string>>();
  private accounts = new Map<number, { login: string; type: string }>();
  private manifestCodes = new Set<string>();
  private publicRepos = new Set<string>();
  private installationTokens = new Map<string, { installationId: number; expiresAt: number }>();
  private userTokens = new Map<string, Set<string>>();

  constructor(private readonly scenario: string) {}

  get url(): string {
    if (!this.server) throw new Error('The GitHub fake is not started');
    return this.baseUrl;
  }

  async start(): Promise<void> {
    const base = loadFixtures('base');
    const overlay = this.scenario === 'base' ? [] : loadFixtures(this.scenario);
    // The scenario sits on top of base; within each, literal routes before parameters
    const ordered = (routes: Route[]) => [...routes].sort((a, b) => paramCount(a) - paramCount(b));
    this.fixtures = [...ordered(overlay), ...ordered(base)];

    this.server = createServer((req, res) => {
      this.handle(req, res).catch(() => {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ message: 'Fake failure' }));
      });
    });
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve));
    this.baseUrl = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  on(route: string, reply: Handler): void {
    this.overrides.unshift(parseRoute(route, reply));
  }

  setApp(app: { appId: number; publicKey: string } | null): void {
    this.app = app;
  }

  addInstallation(
    installationId: number,
    repos: string[],
    account?: { login: string; type: 'Organization' | 'User' },
  ): void {
    this.installations.set(installationId, new Set(repos.map(repoKey)));
    this.accounts.set(
      installationId,
      account ?? {
        login: repos[0]?.split('/')[0] ?? `account-${installationId}`,
        type: 'Organization',
      },
    );
  }

  removeInstallation(installationId: number): void {
    this.installations.delete(installationId);
    this.accounts.delete(installationId);
  }

  issueManifestCode(): string {
    const code = randomBytes(10).toString('hex');
    this.manifestCodes.add(code);
    return code;
  }

  setPublicRepos(repos: string[]): void {
    this.publicRepos = new Set(repos.map(repoKey));
  }

  issueInstallationToken(installationId: number): string {
    if (!this.installations.has(installationId)) {
      throw new Error(`The GitHub fake has no installation ${installationId}`);
    }
    const token = tokenOf('ghs_');
    this.installationTokens.set(token, {
      installationId,
      expiresAt: Date.now() + TOKEN_LIFETIME_MS,
    });
    return token;
  }

  issueUserToken(_login: string, repos: string[]): string {
    const token = tokenOf('ghu_');
    this.userTokens.set(token, new Set(repos.map(repoKey)));
    return token;
  }

  reset(): void {
    this.requests.length = 0;
    this.overrides = [];
  }

  async close(): Promise<void> {
    const server = this.server;
    if (!server) return;
    this.server = null;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  /**
   * Who the Authorization header stands for. A token the fake did not issue, or a JWT that
   * does not verify for the App, is `invalid`.
   * @param header The Authorization header as sent
   */
  private credentialOf(header: string | undefined): Credential {
    if (header === undefined) return { kind: 'none' };
    const [scheme, value = ''] = header.split(/\s+/, 2);
    if (/^basic$/i.test(scheme)) return { kind: 'basic', label: 'basic' };
    if (/^(token|bearer)$/i.test(scheme)) {
      const issued = this.installationTokens.get(value);
      // An expired token, or one of an installation that is gone, is a bad credential
      if (
        issued &&
        issued.expiresAt > Date.now() &&
        this.installations.has(issued.installationId)
      ) {
        const { installationId } = issued;
        return {
          kind: 'installation',
          label: `installation:${installationId}`,
          installationId,
          repos: this.installations.get(installationId),
        };
      }
      const userRepos = this.userTokens.get(value);
      if (userRepos) return { kind: 'user', label: `user:${value.slice(0, 8)}`, repos: userRepos };
      const app = this.app;
      if (/^bearer$/i.test(scheme) && app && verifyAppJwt(value, app.publicKey, app.appId)) {
        return { kind: 'app', label: 'app' };
      }
    }
    return { kind: 'invalid', label: 'invalid' };
  }

  /**
   * GitHub's answer when the credential may not make this call, or null when it may. A wrong
   * credential is 401 everywhere; no credential reads public data only; a token reaches the
   * repositories it was granted, and reads public ones.
   * @param method The HTTP method
   * @param pathname The request path
   * @param credential Who the request authenticated as
   */
  private refusal(method: string, pathname: string, credential: Credential): FakeReply | null {
    const { kind } = credential;
    if (kind === 'invalid') return reply(401, 'Bad credentials');
    if (pathname.startsWith('/web/') || pathname.startsWith('/app-manifests/')) return null;

    const needs = (wanted: Credential['kind']) =>
      kind === wanted ? null : kind === 'none' ? REQUIRES_AUTH : NOT_ACCESSIBLE;
    if (pathname === '/app' || pathname.startsWith('/app/')) {
      return kind === 'app' ? null : reply(401, 'A JSON web token could not be decoded');
    }
    if (kind === 'app') return NOT_ACCESSIBLE;
    if (pathname.startsWith('/applications/')) return needs('basic');
    if (pathname === '/installation' || pathname.startsWith('/installation/')) {
      return needs('installation');
    }
    if (pathname === '/user' || pathname.startsWith('/user/')) return needs('user');

    const repo = /^\/repos\/([^/]+)\/([^/]+)/.exec(pathname);
    if (repo) {
      const key = repoKey(`${decodeURIComponent(repo[1])}/${decodeURIComponent(repo[2])}`);
      if (credential.repos?.has(key)) return null;
      if (!this.publicRepos.has(key)) return NOT_FOUND;
      if (method === 'GET' || method === 'HEAD') return null;
      return kind === 'none' ? NOT_FOUND : NOT_ACCESSIBLE;
    }
    // Other paths (users, orgs, search) hold public data or nothing
    return null;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', this.baseUrl);
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks).toString('utf8');
    const contentType = req.headers['content-type'] ?? '';
    let body: unknown = raw || undefined;
    if (raw && contentType.includes('json')) body = JSON.parse(raw);
    else if (raw && contentType.includes('x-www-form-urlencoded')) {
      body = Object.fromEntries(new URLSearchParams(raw));
    }

    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(req.headers)) {
      if (typeof value === 'string') headers[name] = value;
      else if (Array.isArray(value)) headers[name] = value.join(', ');
    }
    const credential = this.credentialOf(headers.authorization);
    if (credential.label === undefined) delete headers.authorization;
    else headers.authorization = credential.label;

    const recorded: RecordedRequest = {
      method: req.method ?? 'GET',
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      headers,
      body,
    };
    this.requests.push(recorded);

    const answer =
      this.refusal(recorded.method, url.pathname, credential) ??
      this.builtIn(recorded, credential) ??
      this.fromRoutes(recorded);
    if (answer.delayMs) await new Promise((resolve) => setTimeout(resolve, answer.delayMs));
    if (res.destroyed) return;

    const isText = typeof answer.body === 'string' || Buffer.isBuffer(answer.body);
    const outHeaders: Record<string, string> = {
      ...(answer.body !== undefined && !isText && { 'content-type': 'application/json' }),
      ...answer.headers,
    };
    res.writeHead(answer.status, outHeaders);
    if (answer.body === undefined) res.end();
    else res.end(isText ? answer.body : JSON.stringify(answer.body));
  }

  /**
   * Routes whose answer is state, not a fixture. `on` routes still win.
   * @param req The recorded request
   * @param credential Who the request authenticated as
   */
  private builtIn(req: RecordedRequest, credential: Credential): FakeReply | null {
    if (this.overrideFor(req)) return null;
    const tokenRoute = /^\/app\/installations\/(\d+)\/access_tokens$/.exec(req.path);
    if (req.method === 'POST' && tokenRoute) {
      if (!this.installations.has(Number(tokenRoute[1]))) return NOT_FOUND;
      return {
        status: 201,
        body: {
          token: this.issueInstallationToken(Number(tokenRoute[1])),
          expires_at: new Date(Date.now() + TOKEN_LIFETIME_MS).toISOString(),
          permissions: { metadata: 'read', contents: 'write', pull_requests: 'write' },
          repository_selection: 'selected',
        },
      };
    }
    if (req.method === 'GET' && req.path === '/app/installations') {
      return {
        status: 200,
        body: [...this.installations.keys()].map((id) => ({
          id,
          account: { ...this.accounts.get(id), id: 9000 + id },
          app_id: this.app?.appId,
          suspended_at: null,
        })),
      };
    }
    const conversion = /^\/app-manifests\/([^/]+)\/conversions$/.exec(req.path);
    if (req.method === 'POST' && conversion) return this.convertManifest(conversion[1]);
    // The installation's own repositories, out of the fixture list
    if (req.method === 'GET' && req.path === '/installation/repositories') {
      const answer = this.fromRoutes(req);
      const body = answer.body as { repositories?: Array<{ full_name: string }> } | undefined;
      if (!Array.isArray(body?.repositories)) return answer;
      const repositories = body.repositories.filter((repo) =>
        credential.repos?.has(repoKey(repo.full_name)),
      );
      return { ...answer, body: { ...body, total_count: repositories.length, repositories } };
    }
    return null;
  }

  /**
   * The manifest conversion: the fixture's App with a fresh key pair, and the App registered
   * with the fake so its JWTs verify. A code converts once, as on GitHub (404 after).
   * @param code The code from the redirect
   */
  private convertManifest(code: string): FakeReply {
    if (!this.manifestCodes.delete(code)) return NOT_FOUND;
    const found = this.fixtures.find((route) =>
      match(route, 'POST', ['app-manifests', code, 'conversions']),
    );
    const body = found?.handler as FakeReply | undefined;
    if (!body?.body) return { status: 404, body: { message: 'Not Found' } };
    const { publicKey, privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    const app = body.body as { id: number };
    this.app = { appId: app.id, publicKey };
    return { ...body, body: { ...app, pem: privateKey } };
  }

  private overrideFor(req: RecordedRequest) {
    const segments = req.path.split('/').slice(1);
    for (const route of this.overrides) {
      const params = match(route, req.method, segments);
      if (params) return { route, params };
    }
    return null;
  }

  private fromRoutes(req: RecordedRequest): FakeReply {
    const segments = req.path.split('/').slice(1);
    const found =
      this.overrideFor(req) ??
      this.fixtures
        .map((route) => ({ route, params: match(route, req.method, segments) }))
        .find((candidate) => candidate.params !== null);
    if (!found?.params) return { status: 404, body: { message: 'Not Found' } };
    const { handler } = found.route;
    return typeof handler === 'function' ? handler(req, found.params) : handler;
  }
}

/**
 * Starts a fake on a free port.
 * @param opts The fixture scenario, `base` by default
 * @param opts.scenario
 */
export async function startGithubFake(opts: { scenario?: string } = {}): Promise<GithubFake> {
  const fake = new GithubFakeServer(opts.scenario ?? 'base');
  await fake.start();
  return fake;
}

/**
 * A fake for the whole test file: started before the tests, with the GitHub client pointed at
 * it (web paths under `/web`), reset after each test and closed at the end.
 * @param scenario The fixture scenario, `base` by default
 */
export function useGithubFake(scenario = 'base'): GithubFake {
  const fake = new GithubFakeServer(scenario);
  beforeAll(async () => {
    await fake.start();
    setGithubBaseUrls({ api: fake.url, web: `${fake.url}/web` });
  });
  afterEach(() => fake.reset());
  afterAll(async () => {
    setGithubBaseUrls(null);
    await fake.close();
  });
  return fake;
}
