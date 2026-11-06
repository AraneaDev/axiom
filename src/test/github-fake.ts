/**
 * A recorded stand-in for GitHub, served over real HTTP on 127.0.0.1. It answers from the
 * fixtures in `__fixtures__/github/<scenario>/` (base first, the scenario on top), checks
 * credentials the way GitHub does, and records every request, unknown routes included.
 */
import { randomBytes, verify } from 'node:crypto';
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
  /** The App's public key: `/app/*` calls need a JWT that verifies against it */
  setAppPublicKey(publicKeyPem: string | null): void;
  /** A `ghs_` token the fake accepts for that installation */
  issueInstallationToken(installationId: number): string;
  /** A `ghu_` token the fake accepts for that user */
  issueUserToken(login: string): string;
  /** Forgets recorded requests and `on` routes; keys and issued tokens stay */
  reset(): void;
  close(): Promise<void>;
}

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
 * Verifies an RS256 JWT as GitHub does for an App: signature, algorithm and time window.
 * @param token The JWT
 * @param publicKeyPem The App's public key
 */
export function verifyAppJwt(token: string, publicKeyPem: string): boolean {
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
    if (head.alg !== 'RS256' || claims.iss === undefined) return false;
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

class GithubFakeServer implements GithubFake {
  readonly requests: RecordedRequest[] = [];
  private server: Server | null = null;
  private baseUrl = '';
  private overrides: Route[] = [];
  private fixtures: Route[] = [];
  private appPublicKey: string | null = null;
  private installationTokens = new Map<string, number>();
  private userTokens = new Map<string, string>();

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

  setAppPublicKey(publicKeyPem: string | null): void {
    this.appPublicKey = publicKeyPem;
  }

  issueInstallationToken(installationId: number): string {
    const token = tokenOf('ghs_');
    this.installationTokens.set(token, installationId);
    return token;
  }

  issueUserToken(login: string): string {
    const token = tokenOf('ghu_');
    this.userTokens.set(token, login);
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
   * What the Authorization header is, in words a test can assert on
   * @param header
   */
  private credentialKind(header: string | undefined): string | undefined {
    if (header === undefined) return undefined;
    const [scheme, value = ''] = header.split(/\s+/, 2);
    if (/^basic$/i.test(scheme)) return 'basic';
    if (/^(token|bearer)$/i.test(scheme)) {
      const installationId = this.installationTokens.get(value);
      if (installationId !== undefined) return `installation:${installationId}`;
      if (this.userTokens.has(value)) return `user:${value.slice(0, 8)}`;
      if (/^bearer$/i.test(scheme) && this.appPublicKey && verifyAppJwt(value, this.appPublicKey)) {
        return 'app';
      }
    }
    return 'invalid';
  }

  /**
   * Whether the credential may call this path, as GitHub decides it
   * @param pathname
   * @param kind
   */
  private allowed(pathname: string, kind: string | undefined): boolean {
    if (pathname.startsWith('/web/') || pathname.startsWith('/app-manifests/')) return true;
    if (pathname === '/app' || pathname.startsWith('/app/')) return kind === 'app';
    if (pathname.startsWith('/applications/')) return kind === 'basic';
    if (pathname === '/installation' || pathname.startsWith('/installation/')) {
      return kind?.startsWith('installation:') ?? false;
    }
    if (pathname === '/user' || pathname.startsWith('/user/')) {
      return kind?.startsWith('user:') ?? false;
    }
    return (kind?.startsWith('installation:') || kind?.startsWith('user:')) ?? false;
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
    const kind = this.credentialKind(headers.authorization);
    if (kind === undefined) delete headers.authorization;
    else headers.authorization = kind;

    const recorded: RecordedRequest = {
      method: req.method ?? 'GET',
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      headers,
      body,
    };
    this.requests.push(recorded);

    let reply: FakeReply;
    if (!this.allowed(url.pathname, kind)) {
      reply = { status: 401, body: { message: 'Bad credentials' } };
    } else {
      reply = this.builtIn(recorded) ?? this.fromRoutes(recorded);
    }
    if (reply.delayMs) await new Promise((resolve) => setTimeout(resolve, reply.delayMs));
    if (res.destroyed) return;

    const isText = typeof reply.body === 'string' || Buffer.isBuffer(reply.body);
    const outHeaders: Record<string, string> = {
      ...(reply.body !== undefined && !isText && { 'content-type': 'application/json' }),
      ...reply.headers,
    };
    res.writeHead(reply.status, outHeaders);
    if (reply.body === undefined) res.end();
    else res.end(isText ? reply.body : JSON.stringify(reply.body));
  }

  /**
   * Routes whose answer is state, not a fixture
   * @param req
   */
  private builtIn(req: RecordedRequest): FakeReply | null {
    const tokenRoute = /^\/app\/installations\/(\d+)\/access_tokens$/.exec(req.path);
    if (req.method === 'POST' && tokenRoute && !this.overrideFor(req)) {
      return {
        status: 201,
        body: {
          token: this.issueInstallationToken(Number(tokenRoute[1])),
          expires_at: new Date(Date.now() + 60 * 60_000).toISOString(),
          permissions: { metadata: 'read', contents: 'write', pull_requests: 'write' },
          repository_selection: 'selected',
        },
      };
    }
    return null;
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
