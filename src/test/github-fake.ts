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
  /** GitHub suspends the installation (or lifts it); `/app/installations` reports it */
  suspendInstallation(installationId: number, suspended?: boolean): void;
  /** A manifest code, as GitHub puts on the redirect; it converts once */
  issueManifestCode(): string;
  /** Repositories anyone may read, with or without a credential; every other one is private */
  setPublicRepos(repos: string[]): void;
  /** A `ghs_` token for an installation added before, reaching only that installation's repos */
  issueInstallationToken(installationId: number): string;
  /**
   * A `ghu_` token for that user, reaching only the given repositories. `GET /repos/:owner/:repo`
   * answers the repository under the asked name, with `permissions.admin: true` for the ones in
   * `opts.admin` and false for the rest. Without `opts.admin` it answers the fixture as it is.
   */
  issueUserToken(login: string, repos: string[], opts?: { admin?: string[] }): string;
  /**
   * The App's OAuth client credentials, which the token endpoint and the revoke call check.
   * With none set, any are accepted.
   */
  setOAuthClient(client: { clientId: string; clientSecret: string } | null): void;
  /**
   * A code as GitHub puts on the callback redirect after the person agrees: good once, and
   * exchanged at `POST /login/oauth/access_token` for an expiring access token and a refresh
   * token. `GET /user` with that token answers the login and id.
   */
  issueAuthorizationCode(login: string, opts?: { githubUserId?: number; repos?: string[] }): string;
  /** How many `refresh_token` grants the token endpoint has seen */
  readonly refreshGrants: number;
  /** Holds the token endpoint's answer back this long, so two refreshes can overlap */
  setRefreshDelay(ms: number): void;
  /** Every refresh token of that login stops working: the next refresh gets `bad_refresh_token` */
  revokeRefreshTokens(login: string): void;
  /** Whether the fake would still accept this access token, or still honour this refresh token */
  isTokenValid(token: string): boolean;
  /** An access token stops working (GitHub refuses it with 401), its refresh token stays good */
  expireToken(token: string): void;
  /**
   * Installation tokens expire an hour after they are issued, by `Date.now()`, so a test that
   * fakes the clock (`vi.useFakeTimers({ toFake: ['Date'] })`) drives `expires_at` and the
   * fake's refusal of an expired token alike.
   */
  /** Forgets recorded requests, `on` routes and the refresh counter and delay; the rest stays */
  reset(): void;
  close(): Promise<void>;
}

const TOKEN_LIFETIME_MS = 60 * 60_000;
/** A user token from the OAuth endpoint lives 8 hours, as GitHub's do */
const USER_TOKEN_LIFETIME_MS = 8 * 60 * 60_000;
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
  /** For `basic`: the client id and secret that were sent */
  basic?: { id: string; secret: string };
  /** For `user`: whose token it is */
  identity?: { login: string; id: number };
  /** What the recorded `authorization` header says: `app`, `installation:<id>`, `user:<prefix>` */
  label?: string;
  installationId?: number;
  /** The repositories (lowercased `owner/name`) the credential reaches */
  repos?: Set<string>;
  /** For `user`: the repositories (lowercased) the person has admin rights on */
  admin?: Set<string>;
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
  private suspended = new Map<number, string>();
  private manifestCodes = new Set<string>();
  private publicRepos = new Set<string>();
  private installationTokens = new Map<string, { installationId: number; expiresAt: number }>();
  private userTokens = new Map<
    string,
    { repos: Set<string>; admin?: Set<string>; login: string; id: number; expiresAt: number | null }
  >();
  private repoIds = new Map<string, number>();
  private refreshTokens = new Map<string, { login: string; id: number; repos: string[] }>();
  private authCodes = new Map<string, { login: string; id: number; repos: string[] }>();
  private userIds = new Map<string, number>([['octo-dev', 9101]]);
  private oauthClient: { clientId: string; clientSecret: string } | null = null;
  private refreshDelayMs = 0;
  refreshGrants = 0;

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
    // GitHub never reuses an installation id: one added again starts fresh
    this.suspended.delete(installationId);
  }

  suspendInstallation(installationId: number, suspended = true): void {
    if (suspended) {
      if (!this.suspended.has(installationId))
        this.suspended.set(installationId, new Date(Date.now()).toISOString());
    } else this.suspended.delete(installationId);
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

  issueUserToken(login: string, repos: string[], opts: { admin?: string[] } = {}): string {
    return this.mintUserToken(login, this.idOf(login), repos, null, opts.admin);
  }

  setOAuthClient(client: { clientId: string; clientSecret: string } | null): void {
    this.oauthClient = client;
  }

  issueAuthorizationCode(
    login: string,
    opts: { githubUserId?: number; repos?: string[] } = {},
  ): string {
    if (opts.githubUserId !== undefined) this.userIds.set(login, opts.githubUserId);
    const code = randomBytes(10).toString('hex');
    this.authCodes.set(code, { login, id: this.idOf(login), repos: opts.repos ?? [] });
    return code;
  }

  setRefreshDelay(ms: number): void {
    this.refreshDelayMs = ms;
  }

  revokeRefreshTokens(login: string): void {
    for (const [token, owner] of this.refreshTokens) {
      if (owner.login === login) this.refreshTokens.delete(token);
    }
  }

  isTokenValid(token: string): boolean {
    return this.userTokens.has(token) || this.refreshTokens.has(token);
  }

  expireToken(token: string): void {
    this.userTokens.delete(token);
  }

  private idOf(login: string): number {
    let id = this.userIds.get(login);
    if (id === undefined) {
      id = 9200 + this.userIds.size;
      this.userIds.set(login, id);
    }
    return id;
  }

  private mintUserToken(
    login: string,
    id: number,
    repos: string[],
    lifetimeMs: number | null,
    admin?: string[],
  ): string {
    const token = tokenOf('ghu_');
    this.userTokens.set(token, {
      repos: new Set(repos.map(repoKey)),
      admin: admin ? new Set(admin.map(repoKey)) : undefined,
      login,
      id,
      expiresAt: lifetimeMs === null ? null : Date.now() + lifetimeMs,
    });
    return token;
  }

  reset(): void {
    this.requests.length = 0;
    this.overrides = [];
    this.refreshGrants = 0;
    this.refreshDelayMs = 0;
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
    if (/^basic$/i.test(scheme)) {
      const [id = '', secret = ''] = Buffer.from(value, 'base64').toString().split(/:(.*)/s);
      return { kind: 'basic', label: 'basic', basic: { id, secret } };
    }
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
      const user = this.userTokens.get(value);
      // An expired user token is a bad credential, as with an installation token
      if (user && (user.expiresAt === null || user.expiresAt > Date.now())) {
        return {
          kind: 'user',
          label: `user:${value.slice(0, 8)}`,
          repos: user.repos,
          admin: user.admin,
          identity: { login: user.login, id: user.id },
        };
      }
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
    // The App's own view of a repository is a JWT call, as on GitHub
    if (/^\/repos\/[^/]+\/[^/]+\/installation$/.test(pathname)) {
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
      // A user token of the App reaches a private repository only where the App is installed
      const held = [...this.installations.values()].some((repos) => repos.has(key));
      if (credential.repos?.has(key) && (kind !== 'user' || held)) return null;
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
          suspended_at: this.suspended.get(id) ?? null,
        })),
      };
    }
    if (req.method === 'POST' && req.path === '/web/login/oauth/access_token') {
      return this.tokenEndpoint(req.body, req.headers.accept ?? '');
    }
    const revoke = /^\/applications\/([^/]+)\/(token|grant)$/.exec(req.path);
    if (req.method === 'DELETE' && revoke) {
      return this.revokeToken(revoke[1], revoke[2] === 'grant', req.body, credential);
    }
    if (req.method === 'GET' && req.path === '/user' && credential.identity) {
      const found = this.fromRoutes(req);
      const body = found.body as Record<string, unknown> | undefined;
      return { ...found, body: { ...body, ...credential.identity } };
    }
    const installed = /^\/repos\/([^/]+)\/([^/]+)\/installation$/.exec(req.path);
    if (req.method === 'GET' && installed) {
      return this.repoInstallation(
        `${decodeURIComponent(installed[1])}/${decodeURIComponent(installed[2])}`,
        req,
      );
    }
    const repoRead = /^\/repos\/([^/]+)\/([^/]+)$/.exec(req.path);
    if (req.method === 'GET' && repoRead && credential.kind === 'user') {
      return this.repoForUser(
        `${decodeURIComponent(repoRead[1])}/${decodeURIComponent(repoRead[2])}`,
        req,
        credential,
      );
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
   * `GET /repos/:owner/:repo/installation`: the installation that reaches the repository, 404
   * when the App is not installed on it.
   * @param fullName The repository as `owner/name`
   * @param req The recorded request, for the fixture the answer is shaped like
   */
  private repoInstallation(fullName: string, req: RecordedRequest): FakeReply {
    const shape = (this.fromRoutes(req).body ?? {}) as Record<string, unknown>;
    const key = repoKey(fullName);
    for (const [id, repos] of this.installations) {
      if (!repos.has(key)) continue;
      const account = this.accounts.get(id);
      return {
        status: 200,
        body: {
          ...shape,
          id,
          account: { login: account?.login, type: account?.type, id: 9000 + id },
          app_id: this.app?.appId,
          suspended_at: this.suspended.get(id) ?? null,
        },
      };
    }
    return NOT_FOUND;
  }

  /**
   * `GET /repos/:owner/:repo` for a user token: the fixture's repository under the asked name,
   * with `permissions.admin` as the token was issued. The fixture's own repository keeps its id.
   * @param fullName The repository as asked
   * @param req The recorded request
   * @param credential The user token's credential
   */
  private repoForUser(fullName: string, req: RecordedRequest, credential: Credential): FakeReply {
    const found = this.fromRoutes(req);
    // A token issued without `admin` gets the fixture as it is
    if (!credential.admin) return found;
    const body = found.body as
      | (Record<string, unknown> & { owner?: object; permissions?: object })
      | undefined;
    if (found.status !== 200 || !body) return found;
    const key = repoKey(fullName);
    let id = body.id as number;
    if (repoKey(String(body.full_name)) !== key) {
      id = this.repoIds.get(key) ?? 7400 + this.repoIds.size;
      this.repoIds.set(key, id);
    }
    const [owner, name] = fullName.split('/');
    const isAdmin = credential.admin?.has(key) === true;
    return {
      ...found,
      body: {
        ...body,
        id,
        name,
        full_name: fullName,
        html_url: `https://github.com/${fullName}`,
        url: `https://api.github.com/repos/${fullName}`,
        owner: { ...body.owner, login: owner, html_url: `https://github.com/${owner}` },
        permissions: { ...body.permissions, admin: isAdmin, maintain: isAdmin },
      },
    };
  }

  /**
   * GitHub's OAuth token endpoint for the code grant and the refresh_token grant. Refusals are
   * 200 with an `error`, as GitHub answers them. A refresh token works once: the grant hands
   * out a new one.
   * @param body The JSON body that was sent
   * @param accept The Accept header: GitHub answers in JSON only when asked, else form-encoded
   */
  private tokenEndpoint(body: unknown, accept: string): FakeReply {
    const answer = this.tokenAnswer(body);
    if (accept.includes('application/json')) return answer;
    const fields = Object.entries(answer.body as Record<string, unknown>).map(
      ([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`,
    );
    return {
      ...answer,
      body: fields.join('&'),
      headers: { 'content-type': 'application/x-www-form-urlencoded; charset=utf-8' },
    };
  }

  private tokenAnswer(body: unknown): FakeReply {
    const input = (body ?? {}) as Record<string, string>;
    const refused = (error: string, description: string): FakeReply => ({
      status: 200,
      body: { error, error_description: description },
      delayMs: this.refreshDelayMs,
    });
    const isRefresh = input.grant_type === 'refresh_token';
    if (isRefresh) this.refreshGrants += 1;
    const client = this.oauthClient;
    if (
      client &&
      (input.client_id !== client.clientId || input.client_secret !== client.clientSecret)
    ) {
      return refused(
        'incorrect_client_credentials',
        'The client_id and/or client_secret passed are incorrect.',
      );
    }
    let owner: { login: string; id: number; repos: string[] } | undefined;
    if (isRefresh) {
      owner = this.refreshTokens.get(input.refresh_token ?? '');
      if (!owner)
        return refused('bad_refresh_token', 'The refresh token passed is incorrect or expired.');
      this.refreshTokens.delete(input.refresh_token);
    } else {
      owner = this.authCodes.get(input.code ?? '');
      if (!owner)
        return refused('bad_verification_code', 'The code passed is incorrect or expired.');
      this.authCodes.delete(input.code);
    }
    const refreshToken = tokenOf('ghr_');
    this.refreshTokens.set(refreshToken, owner);
    return {
      status: 200,
      delayMs: isRefresh ? this.refreshDelayMs : 0,
      body: {
        access_token: this.mintUserToken(
          owner.login,
          owner.id,
          owner.repos,
          USER_TOKEN_LIFETIME_MS,
        ),
        expires_in: USER_TOKEN_LIFETIME_MS / 1000,
        refresh_token: refreshToken,
        refresh_token_expires_in: 15_811_200,
        token_type: 'bearer',
        scope: '',
      },
    };
  }

  /**
   * `DELETE /applications/:client_id/token` revokes the token in the body;
   * `.../grant` revokes the whole authorization of that token's user: every access token and
   * every refresh token.
   * @param clientId The client id in the path
   * @param wholeGrant Whether the path ends in `grant`
   * @param body The JSON body, `{ access_token }`
   * @param credential Who the request authenticated as (the App's client credentials)
   */
  private revokeToken(
    clientId: string,
    wholeGrant: boolean,
    body: unknown,
    credential: Credential,
  ): FakeReply {
    const client = this.oauthClient;
    const sent = credential.basic;
    if (
      client &&
      (sent?.id !== client.clientId ||
        sent.secret !== client.clientSecret ||
        clientId !== client.clientId)
    ) {
      return reply(401, 'Bad credentials');
    }
    const token = (body as { access_token?: string } | undefined)?.access_token ?? '';
    const owner = this.userTokens.get(token);
    if (!owner) return NOT_FOUND;
    if (wholeGrant) {
      for (const [other, entry] of this.userTokens) {
        if (entry.login === owner.login) this.userTokens.delete(other);
      }
      this.revokeRefreshTokens(owner.login);
    } else this.userTokens.delete(token);
    return { status: 204 };
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
