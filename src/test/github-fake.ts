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

/** A function that answers null passes the request on, as if its route were not there */
type Handler =
  | FakeReply
  | ((req: RecordedRequest, params: Record<string, string>) => FakeReply | null);

interface Route {
  method: string;
  segments: string[];
  handler: Handler;
}

export interface GithubFake {
  readonly url: string;
  readonly requests: RecordedRequest[];
  /**
   * Answers a route, ahead of the fixtures and the built-in routes, until `reset`. `route` as
   * `'GET /repos/:owner/:repo'`. A function that returns null lets the request through to them.
   */
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
  /** Every installation token issued so far for that installation stops working (GitHub revoked them early: 401) */
  revokeInstallationTokens(installationId: number): void;
  /** A `ghs_` token for an installation added before, reaching only that installation's repos */
  issueInstallationToken(installationId: number): string;
  /**
   * A `ghu_` token for that user, reaching only the given repositories. `GET /repos/:owner/:repo`
   * answers the repository under the asked name, with `permissions.admin: true` for the ones in
   * `opts.admin` and false for the rest. Without `opts.admin` it answers the fixture as it is.
   * With `opts.push`, writing git refs works only on the repositories listed there; the others
   * answer 403 as GitHub does for a token without write access, and so does opening, updating or
   * commenting on a pull request and re-running checks. Without it every reachable
   * repository may be written.
   */
  issueUserToken(
    login: string,
    repos: string[],
    opts?: { admin?: string[]; push?: string[] },
  ): string;
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
  /**
   * A job's log, as GitHub serves it: `GET /repos/:o/:r/actions/jobs/:id/logs` answers 302 to a
   * signed URL on another origin (`localhost`, not the API's `127.0.0.1`) that serves the text
   * as `text/plain` and refuses a request that carries an Authorization header, as blob storage
   * does. The blob host honours `Range: bytes=-N` with a 206, except in `no-range` mode (200, everything) and `head-range` mode (206 with the start of the file), where it
   * answers 200 with everything. `not-found` and `gone` (expired logs) are answered by the API
   * itself, `slow` makes the blob host take {@link SLOW_BLOB_MS} before it answers. Forgotten by `reset`.
   */
  setJobLog(jobId: number, text: string | Buffer, mode?: JobLogMode): void;
  /**
   * What a repository lists: `GET .../pulls?state=open` (the open ones of `pulls`),
   * `.../pulls/:number` (any of them), `.../commits/:sha/check-runs` (`checkRuns` by head sha)
   * and `.../branches`. Lists are cut into pages of `per_page` with Link headers, as GitHub does.
   * Forgotten by `reset`.
   */
  setRepoLists(
    fullName: string,
    lists: {
      pulls?: Array<Record<string, unknown>>;
      checkRuns?: Record<string, Array<Record<string, unknown>>>;
      branches?: Array<{ name: string; sha: string }>;
      /**
       * GitHub Issues: `GET .../issues` (by `state`, open by default, and `since`, pull requests
       * included as GitHub lists them) and `.../issues/:number`. Commenting works on these as on
       * `pulls`.
       */
      issues?: Array<Record<string, unknown>>;
      /**
       * The comments of an issue or pull request by number, served by
       * `GET .../issues/:number/comments` and, all of them with an `issue_url`, by
       * `GET .../issues/comments` (both with `since`, as GitHub filters it); a comment posted on
       * one is added here. Without it the fixtures answer those routes.
       */
      issueComments?: Record<string, Array<Record<string, unknown>>>;
    },
  ): void;
  /**
   * The id of a repository, so `/repositories/<id>/...` answers as `/repos/<owner>/<name>/...`
   * does (an unknown id is 404). Requests are recorded under the path that was asked.
   */
  setRepoId(fullName: string, id: number): void;
  /**
   * The branch heads of a repository (`name` to commit sha), served by
   * `GET /repos/:o/:r/git/ref/heads/<name>` (404 "Not Found" for a missing one) and extended by
   * `POST /repos/:o/:r/git/refs`, which answers 422 "Reference already exists" for a name that
   * is there and 422 "Object does not exist" for a sha no branch points at. Forgotten by `reset`.
   * The write routes of pull requests (open, update, request reviewers, comment) and of checks
   * (`rerun-failed-jobs`, `rerequest`) answer in GitHub's shapes; a branch they name must be one
   * of these heads, once heads are set.
   */
  setGitRefs(fullName: string, heads: Record<string, string>): void;
  /**
   * The Actions workflow runs of a repository (their ids): `rerun-failed-jobs` of any other id is
   * 404, as on GitHub. Forgotten by `reset`.
   */
  setWorkflowRuns(fullName: string, ids: number[]): void;
  /**
   * The users who may be asked to review in a repository. Once set, requesting anyone else is 422
   * "Reviews may only be requested from collaborators", and so is requesting the PR's author.
   * Forgotten by `reset`.
   */
  setCollaborators(fullName: string, logins: string[]): void;
  /**
   * The issues a pull request of a repository closes, as GitHub's GraphQL
   * `PullRequest.closingIssuesReferences` lists them: each by number and the database id of its
   * repository. `POST /graphql` answers `repository(owner, name)` with its `databaseId` and every
   * aliased `pullRequest(number: N)` with these (none when unset), for a credential that reaches
   * the repository; otherwise `repository` is null with a NOT_FOUND error, as on GitHub.
   * Forgotten by `reset`.
   */
  setClosingReferences(
    fullName: string,
    pull: number,
    refs: Array<{ number: number; repoId: number }>,
  ): void;
  /** Forgets recorded requests, `on` routes, job logs, repository lists, closing references, the comment counter and the refresh counter and delay; the rest (repository ids included) stays */
  reset(): void;
  close(): Promise<void>;
}

export type JobLogMode = 'ok' | 'not-found' | 'gone' | 'slow' | 'no-range' | 'head-range';
/** How long the blob host holds a `slow` log back */
export const SLOW_BLOB_MS = 400;
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
  /** For `user`: the repositories (lowercased) the token may write; unset means all it reaches */
  push?: Set<string>;
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
    {
      repos: Set<string>;
      admin?: Set<string>;
      push?: Set<string>;
      login: string;
      id: number;
      expiresAt: number | null;
    }
  >();
  private gitRefs = new Map<string, Map<string, string>>();
  private repoIds = new Map<string, number>();
  private refreshTokens = new Map<string, { login: string; id: number; repos: string[] }>();
  private authCodes = new Map<string, { login: string; id: number; repos: string[] }>();
  private userIds = new Map<string, number>([['octo-dev', 9101]]);
  private oauthClient: { clientId: string; clientSecret: string } | null = null;
  private refreshDelayMs = 0;
  private jobLogs = new Map<number, { text: string | Buffer; mode: JobLogMode }>();
  private repoLists = new Map<string, Parameters<GithubFake['setRepoLists']>[1]>();
  refreshGrants = 0;
  private commentIds = 0;
  private workflowRuns = new Map<string, Set<number>>();
  private collaborators = new Map<string, Set<string>>();
  private closingRefs = new Map<string, Array<{ number: number; repoId: number }>>();

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

  issueUserToken(
    login: string,
    repos: string[],
    opts: { admin?: string[]; push?: string[] } = {},
  ): string {
    return this.mintUserToken(login, this.idOf(login), repos, null, opts.admin, opts.push);
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
    push?: string[],
  ): string {
    const token = tokenOf('ghu_');
    this.userTokens.set(token, {
      repos: new Set(repos.map(repoKey)),
      admin: admin ? new Set(admin.map(repoKey)) : undefined,
      push: push ? new Set(push.map(repoKey)) : undefined,
      login,
      id,
      expiresAt: lifetimeMs === null ? null : Date.now() + lifetimeMs,
    });
    return token;
  }

  revokeInstallationTokens(installationId: number): void {
    for (const [token, issued] of this.installationTokens) {
      if (issued.installationId === installationId) this.installationTokens.delete(token);
    }
  }

  setJobLog(jobId: number, text: string | Buffer, mode: JobLogMode = 'ok'): void {
    this.jobLogs.set(jobId, { text, mode });
  }

  setRepoLists(fullName: string, lists: Parameters<GithubFake['setRepoLists']>[1]): void {
    this.repoLists.set(repoKey(fullName), lists);
  }

  setRepoId(fullName: string, id: number): void {
    this.repoIds.set(repoKey(fullName), id);
  }

  /**
   * The `/repos/<owner>/<name>/...` path a `/repositories/<id>/...` path stands for, the path
   * itself when it is not one, and null for an id the fake does not know.
   * @param pathname The request path
   */
  private byIdPath(pathname: string): string | null {
    const byId = /^\/repositories\/(\d+)(\/.*)?$/.exec(pathname);
    if (!byId) return pathname;
    for (const [key, id] of this.repoIds) {
      if (id === Number(byId[1])) return `/repos/${key}${byId[2] ?? ''}`;
    }
    return null;
  }

  setGitRefs(fullName: string, heads: Record<string, string>): void {
    this.gitRefs.set(repoKey(fullName), new Map(Object.entries(heads)));
  }

  setWorkflowRuns(fullName: string, ids: number[]): void {
    this.workflowRuns.set(repoKey(fullName), new Set(ids));
  }

  setCollaborators(fullName: string, logins: string[]): void {
    this.collaborators.set(repoKey(fullName), new Set(logins));
  }

  setClosingReferences(
    fullName: string,
    pull: number,
    refs: Array<{ number: number; repoId: number }>,
  ): void {
    this.closingRefs.set(`${repoKey(fullName)}#${pull}`, refs);
  }

  reset(): void {
    this.closingRefs.clear();
    this.workflowRuns.clear();
    this.collaborators.clear();
    this.requests.length = 0;
    this.gitRefs.clear();
    this.overrides = [];
    this.jobLogs.clear();
    this.repoLists.clear();
    this.commentIds = 0;
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
          push: user.push,
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

    // A repository addressed by id answers as the same call by name
    const routedPath = this.byIdPath(url.pathname);
    const routed = routedPath ? { ...recorded, path: routedPath } : recorded;
    const answer = !routedPath
      ? NOT_FOUND
      : (this.refusal(routed.method, routedPath, credential) ??
        this.builtIn(routed, credential) ??
        this.fromRoutes(routed));
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
    const override = this.overrideAnswer(req);
    if (override) return override;
    const search = this.searchAnswer(req);
    if (search) return search;
    const graphql = this.graphqlAnswer(req, credential);
    if (graphql) return graphql;
    const jobLog = this.jobLogAnswer(req, credential);
    if (jobLog) return jobLog;
    const listed = this.repoListAnswer(req);
    if (listed) return listed;
    const ref = this.gitRefAnswer(req, credential);
    if (ref) return ref;
    const written = this.repoWriteAnswer(req, credential);
    if (written) return written;
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
   * The git ref routes of `setGitRefs`: reading a branch head and creating a branch, with
   * GitHub's shapes and its refusals.
   * @param req The recorded request
   * @param credential Who the request authenticated as
   */
  private gitRefAnswer(req: RecordedRequest, credential: Credential): FakeReply | null {
    const match = /^\/repos\/([^/]+)\/([^/]+)\/git\/(ref\/heads\/.+|refs\/heads\/.+|refs)$/.exec(
      req.path,
    );
    if (!match) return null;
    const key = repoKey(`${decodeURIComponent(match[1])}/${decodeURIComponent(match[2])}`);
    const heads = this.gitRefs.get(key);
    if (!heads) return null;
    const shape = (name: string, sha: string) => ({
      ref: `refs/heads/${name}`,
      node_id: 'REF_kwDOexample',
      url: `https://api.github.com/repos/${key}/git/refs/heads/${name}`,
      object: {
        sha,
        type: 'commit',
        url: `https://api.github.com/repos/${key}/git/commits/${sha}`,
      },
    });
    if (req.method === 'GET' && match[3] !== 'refs') {
      const name = match[3].slice('ref/heads/'.length).split('/').map(decodeURIComponent).join('/');
      const sha = heads.get(name);
      return sha ? { status: 200, body: shape(name, sha) } : NOT_FOUND;
    }
    if (req.method === 'DELETE' && match[3].startsWith('refs/heads/')) {
      if (credential.push && !credential.push.has(key)) return NOT_ACCESSIBLE;
      const name = match[3]
        .slice('refs/heads/'.length)
        .split('/')
        .map(decodeURIComponent)
        .join('/');
      // GitHub answers 422 for a ref that is not there, and 204 without a body for one deleted
      if (!heads.delete(name)) return reply(422, 'Reference does not exist');
      // As GitHub does: a pull request whose head is the deleted branch is closed
      const now = new Date().toISOString();
      for (const pr of this.repoLists.get(key)?.pulls ?? []) {
        if (pr.state === 'open' && (pr.head as { ref?: string } | undefined)?.ref === name) {
          Object.assign(pr, { state: 'closed', closed_at: now, updated_at: now });
        }
      }
      return { status: 204 };
    }
    if (req.method === 'POST' && match[3] === 'refs') {
      if (credential.push && !credential.push.has(key)) return NOT_ACCESSIBLE;
      const { ref, sha } = (req.body ?? {}) as { ref?: unknown; sha?: unknown };
      if (typeof ref !== 'string' || !ref.startsWith('refs/heads/') || typeof sha !== 'string') {
        return reply(422, 'Invalid request');
      }
      const name = ref.slice('refs/heads/'.length);
      if (heads.has(name)) return reply(422, 'Reference already exists');
      if (![...heads.values()].includes(sha)) return reply(422, 'Object does not exist');
      heads.set(name, sha);
      return { status: 201, body: shape(name, sha) };
    }
    return null;
  }

  /**
   * The write routes of a repository, with GitHub's shapes and refusals: opening a pull request
   * (422 "A pull request already exists" for a head that has an open one), updating it,
   * requesting reviewers, commenting on an issue or pull request, and re-running Actions jobs and
   * checks. Pull requests live in the `pulls` of `setRepoLists`, so a later read finds them.
   * A token whose `push` list lacks the repository answers 403 to every one of them.
   * @param req The recorded request
   * @param credential Who the request authenticated as
   */
  private repoWriteAnswer(req: RecordedRequest, credential: Credential): FakeReply | null {
    const match = /^\/repos\/([^/]+)\/([^/]+)\/(.+)$/.exec(req.path);
    if (!match || !['POST', 'PATCH', 'PUT'].includes(req.method)) return null;
    const rest = match[3];
    const open = /^pulls\/(\d+)$/.exec(rest);
    const reviewers = /^pulls\/(\d+)\/requested_reviewers$/.exec(rest);
    const comment = /^issues\/(\d+)\/comments$/.exec(rest);
    const rerun = /^actions\/runs\/(\d+)\/rerun-failed-jobs$/.exec(rest);
    const rerequest = /^check-runs\/(\d+)\/rerequest$/.exec(rest);
    const merge = /^pulls\/(\d+)\/merge$/.exec(rest);
    const known =
      (req.method === 'PUT' && merge) ||
      (req.method === 'POST' && (rest === 'pulls' || reviewers || comment || rerun || rerequest)) ||
      (req.method === 'PATCH' && open);
    if (!known) return null;
    const fullName = `${decodeURIComponent(match[1])}/${decodeURIComponent(match[2])}`;
    const key = repoKey(fullName);
    if (credential.push && !credential.push.has(key)) return NOT_ACCESSIBLE;
    if (rerun) {
      return this.workflowRuns.get(key)?.has(Number(rerun[1]))
        ? { status: 201, body: {} }
        : NOT_FOUND;
    }
    if (rerequest) {
      // Only the App that created a check run may rerequest it, and Axiom's App creates none
      const known = Object.values(this.repoLists.get(key)?.checkRuns ?? {})
        .flat()
        .some((r) => Number(r.id) === Number(rerequest[1]));
      return known ? reply(403, 'Resource not accessible by integration') : NOT_FOUND;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (comment) {
      const stored = this.repoLists.get(key);
      const isNumber = (item: Record<string, unknown>) =>
        Number(item.number) === Number(comment[1]);
      const issue = stored?.issues?.some(isNumber);
      if (!issue && !stored?.pulls?.some(isNumber)) return NOT_FOUND;
      this.commentIds += 1;
      const id = 5000 + this.commentIds;
      const now = new Date().toISOString();
      // An installation comments as the App's bot, as on GitHub
      const app = credential.kind === 'installation';
      const posted: Record<string, unknown> = {
        id,
        html_url: `https://github.com/${fullName}/${issue ? 'issues' : 'pull'}/${comment[1]}#issuecomment-${id}`,
        body: body.body,
        user: app
          ? { login: 'acme-axiom[bot]', id: 9_900_001, type: 'Bot' }
          : (credential.identity ?? { login: 'octo-dev', id: 9101 }),
        ...(app && {
          performed_via_github_app: { id: this.app?.appId ?? null, slug: 'acme-axiom' },
        }),
        created_at: now,
        updated_at: now,
      };
      if (stored?.issueComments) (stored.issueComments[comment[1]] ??= []).push(posted);
      return { status: 201, body: posted };
    }

    let lists = this.repoLists.get(key);
    if (!lists) {
      lists = {};
      this.repoLists.set(key, lists);
    }
    const pulls = (lists.pulls ??= []);
    const heads = this.gitRefs.get(key);
    const invalid = (field: string, code = 'invalid'): FakeReply => ({
      status: 422,
      body: {
        message: 'Validation Failed',
        errors: [{ resource: 'PullRequest', field, code }],
        documentation_url: 'https://docs.github.com/rest/pulls/pulls#create-a-pull-request',
      },
    });
    const who = credential.identity ?? { login: 'octo-dev', id: 9101 };
    const now = new Date().toISOString();

    if (rest === 'pulls') {
      if (typeof body.title !== 'string' || !body.title) return invalid('title', 'missing_field');
      if (typeof body.head !== 'string' || !body.head) return invalid('head', 'missing_field');
      const base = typeof body.base === 'string' ? body.base : '';
      // A head may be written owner:branch, as GitHub takes it
      const head = body.head.includes(':') ? body.head.split(':').slice(1).join(':') : body.head;
      if (heads && !heads.has(head)) return invalid('head');
      if (!base || (heads && !heads.has(base))) return invalid('base');
      // As GitHub answers for a head that has no commit of its own yet
      if (heads && heads.get(head) === heads.get(base)) {
        return {
          status: 422,
          body: {
            message: 'Validation Failed',
            errors: [
              {
                resource: 'PullRequest',
                code: 'custom',
                message: `No commits between ${base} and ${head}`,
              },
            ],
            documentation_url: 'https://docs.github.com/rest/pulls/pulls#create-a-pull-request',
          },
        };
      }
      if (pulls.some((pr) => pr.state === 'open' && (pr.head as { ref: string }).ref === head)) {
        return {
          status: 422,
          body: {
            message: 'Validation Failed',
            errors: [
              {
                resource: 'PullRequest',
                code: 'custom',
                message: `A pull request already exists for ${match[1]}:${head}.`,
              },
            ],
            documentation_url: 'https://docs.github.com/rest/pulls/pulls#create-a-pull-request',
          },
        };
      }
      const number = Math.max(0, ...pulls.map((pr) => Number(pr.number))) + 1;
      const created = {
        number,
        title: body.title,
        body: typeof body.body === 'string' ? body.body : null,
        state: 'open',
        draft: body.draft === true,
        merged: false,
        user: { login: who.login, id: who.id },
        head: { ref: head, sha: heads?.get(head) ?? 'f'.repeat(40) },
        base: { ref: base },
        mergeable_state: 'unknown',
        merge_commit_sha: null,
        requested_reviewers: [],
        html_url: `https://github.com/${fullName}/pull/${number}`,
        created_at: now,
        updated_at: now,
        merged_at: null,
        closed_at: null,
      };
      pulls.push(created);
      return { status: 201, body: created };
    }

    const number = Number((open ?? reviewers ?? merge)?.[1]);
    const found = pulls.find((pr) => Number(pr.number) === number);
    if (!found) return NOT_FOUND;
    if (merge) {
      // As GitHub answers: 405 for a pull request that cannot be merged, 409 when `sha` is not
      // the head any more, 422 for a merge method it does not know
      if (found.state !== 'open' || found.mergeable === false) {
        return reply(405, 'Pull Request is not mergeable');
      }
      if (typeof body.sha === 'string' && body.sha !== (found.head as { sha: string }).sha) {
        return reply(409, 'Head branch was modified. Review and try the merge again.');
      }
      if (
        body.merge_method !== undefined &&
        !['merge', 'squash', 'rebase'].includes(String(body.merge_method))
      ) {
        return invalid('merge_method');
      }
      this.commentIds += 1;
      const mergeSha = this.commentIds.toString(16).padStart(40, '0');
      Object.assign(found, {
        state: 'closed',
        merged: true,
        merged_at: now,
        closed_at: now,
        updated_at: now,
        merge_commit_sha: mergeSha,
      });
      return {
        status: 200,
        body: { sha: mergeSha, merged: true, message: 'Pull Request successfully merged' },
      };
    }
    if (reviewers) {
      const logins = Array.isArray(body.reviewers) ? (body.reviewers as string[]) : [];
      const author = (found.user as { login?: string } | undefined)?.login;
      if (logins.some((l) => l === author)) {
        return {
          status: 422,
          body: {
            message: 'Validation Failed',
            errors: [
              {
                resource: 'PullRequestReviewRequest',
                code: 'custom',
                message: 'Review cannot be requested from pull request author.',
              },
            ],
          },
        };
      }
      const collaborators = this.collaborators.get(key);
      if (collaborators && logins.some((l) => !collaborators.has(l))) {
        return {
          status: 422,
          body: {
            message: 'Validation Failed',
            errors: [
              {
                resource: 'PullRequestReviewRequest',
                code: 'custom',
                message: `Reviews may only be requested from collaborators. One or more of the users or teams you specified is not a collaborator of the ${fullName} repository.`,
              },
            ],
          },
        };
      }
      const current = (found.requested_reviewers as Array<{ login: string; id: number }>) ?? [];
      for (const login of logins) {
        if (!current.some((r) => r.login === login)) {
          current.push({ login, id: this.idOf(login) });
        }
      }
      found.requested_reviewers = current;
      found.updated_at = now;
      return { status: 201, body: found };
    }
    if (typeof body.title === 'string') found.title = body.title;
    if (typeof body.body === 'string') found.body = body.body;
    if (body.state === 'closed' || body.state === 'open') {
      found.state = body.state;
      found.closed_at = body.state === 'closed' ? now : null;
    }
    if (typeof body.base === 'string') {
      if (heads && !heads.has(body.base)) return invalid('base');
      found.base = { ref: body.base };
    }
    found.updated_at = now;
    return { status: 200, body: found };
  }

  /**
   * The list routes of `setRepoLists`, cut into pages with a Link header to the next one.
   * @param req The recorded request
   */
  private repoListAnswer(req: RecordedRequest): FakeReply | null {
    if (req.method !== 'GET') return null;
    const match = /^\/repos\/([^/]+)\/([^/]+)\/(.+)$/.exec(req.path);
    if (!match) return null;
    const lists = this.repoLists.get(
      repoKey(`${decodeURIComponent(match[1])}/${decodeURIComponent(match[2])}`),
    );
    if (!lists) return null;
    const rest = match[3];
    const page = (items: unknown[], wrap?: (slice: unknown[]) => unknown): FakeReply => {
      const perPage = Math.min(Number(req.query.per_page) || 30, 100);
      const number = Math.max(Number(req.query.page) || 1, 1);
      const slice = items.slice((number - 1) * perPage, number * perPage);
      const headers: Record<string, string> = {};
      if (number * perPage < items.length) {
        const next = new URL(req.path, this.baseUrl);
        for (const [key, value] of Object.entries(req.query)) next.searchParams.set(key, value);
        next.searchParams.set('page', String(number + 1));
        headers.link = `<${next.toString()}>; rel="next"`;
      }
      return { status: 200, body: wrap ? wrap(slice) : slice, headers };
    };
    if (rest === 'pulls' && lists.pulls) {
      const wanted = req.query.state ?? 'open';
      // `head` is owner:branch, as GitHub takes it
      const head = req.query.head?.split(':').slice(1).join(':');
      return page(
        lists.pulls.filter(
          (pr) =>
            (wanted === 'all' || pr.state === wanted) &&
            (!head || (pr.head as { ref: string }).ref === head),
        ),
      );
    }
    const one = /^pulls\/(\d+)$/.exec(rest);
    if (one && lists.pulls) {
      const found = lists.pulls.find((pr) => pr.number === Number(one[1]));
      return found ? { status: 200, body: found } : NOT_FOUND;
    }
    const runs = /^commits\/([^/]+)\/check-runs$/.exec(rest);
    if (runs && lists.checkRuns) {
      const all = lists.checkRuns[runs[1]] ?? [];
      return page(all, (slice) => ({ total_count: all.length, check_runs: slice }));
    }
    if (rest === 'branches' && lists.branches) {
      return page(lists.branches.map((b) => ({ name: b.name, commit: { sha: b.sha } })));
    }
    // `since` keeps what was updated at or after it, as GitHub does
    const since = req.query.since ? Date.parse(req.query.since) : null;
    const updatedOf = (item: Record<string, unknown>) =>
      Date.parse(String(item.updated_at ?? item.created_at));
    const fresh = (item: Record<string, unknown>) => since === null || updatedOf(item) >= since;
    // `sort=updated` orders by update, newest first unless `direction=asc`, as GitHub does
    const sorted = (items: Array<Record<string, unknown>>) =>
      req.query.sort !== 'updated'
        ? items
        : [...items].sort((x, y) =>
            req.query.direction === 'asc'
              ? updatedOf(x) - updatedOf(y)
              : updatedOf(y) - updatedOf(x),
          );
    if (rest === 'issues' && lists.issues) {
      const wanted = req.query.state ?? 'open';
      return page(
        sorted(
          lists.issues.filter((item) => (wanted === 'all' || item.state === wanted) && fresh(item)),
        ),
      );
    }
    // Every comment of the repository's issues and pull requests, each with its issue_url
    if (rest === 'issues/comments' && lists.issueComments) {
      const key = repoKey(`${decodeURIComponent(match[1])}/${decodeURIComponent(match[2])}`);
      return page(
        sorted(
          Object.entries(lists.issueComments)
            .flatMap(([number, comments]) =>
              comments.map((c) => ({
                issue_url: `https://api.github.com/repos/${key}/issues/${number}`,
                ...c,
              })),
            )
            .filter(fresh),
        ),
      );
    }
    const issue = /^issues\/(\d+)$/.exec(rest);
    if (issue && lists.issues) {
      const found = lists.issues.find((item) => Number(item.number) === Number(issue[1]));
      return found ? { status: 200, body: found } : NOT_FOUND;
    }
    const issueComments = /^issues\/(\d+)\/comments$/.exec(rest);
    if (issueComments && lists.issueComments) {
      return page((lists.issueComments[issueComments[1]] ?? []).filter(fresh));
    }
    return null;
  }

  /**
   * The job log routes: the API's redirect to the blob host, and the blob host's text.
   * @param req The recorded request
   * @param credential Who the request authenticated as
   */
  private jobLogAnswer(req: RecordedRequest, credential: Credential): FakeReply | null {
    if (req.method !== 'GET') return null;
    const api = /^\/repos\/([^/]+)\/([^/]+)\/actions\/jobs\/(\d+)\/logs$/.exec(req.path);
    if (api) {
      const log = this.jobLogs.get(Number(api[3]));
      if (!log) return NOT_FOUND;
      if (log.mode === 'not-found') return NOT_FOUND;
      if (log.mode === 'gone') return reply(410, 'Logs expired');
      const blob = this.baseUrl.replace('127.0.0.1', 'localhost');
      const signature = randomBytes(8).toString('hex');
      return {
        status: 302,
        headers: { location: `${blob}/blob/job-logs/${api[3]}?sig=${signature}` },
      };
    }
    const blob = /^\/blob\/job-logs\/(\d+)$/.exec(req.path);
    if (!blob) return null;
    // Blob storage takes its authority from the signed URL and refuses a second one
    if (credential.kind !== 'none')
      return reply(403, 'Authentication information is given in multiple places');
    const log = this.jobLogs.get(Number(blob[1]));
    if (!log) return NOT_FOUND;
    const delayMs = log.mode === 'slow' ? SLOW_BLOB_MS : undefined;
    const headers = { 'content-type': 'text/plain; charset=utf-8' };
    const wanted = /^bytes=-(\d+)$/.exec(req.headers.range ?? '');
    const bytes = typeof log.text === 'string' ? Buffer.from(log.text, 'utf8') : log.text;
    if (wanted && log.mode === 'head-range' && bytes.length > Number(wanted[1])) {
      // A host that answers a suffix range with the start of the file
      const end = Number(wanted[1]);
      return {
        status: 206,
        body: bytes.subarray(0, end),
        headers: { ...headers, 'content-range': `bytes 0-${end - 1}/${bytes.length}` },
        delayMs,
      };
    }
    if (wanted && log.mode !== 'no-range' && bytes.length > Number(wanted[1])) {
      const start = bytes.length - Number(wanted[1]);
      return {
        status: 206,
        body: bytes.subarray(start),
        headers: {
          ...headers,
          'content-range': `bytes ${start}-${bytes.length - 1}/${bytes.length}`,
        },
        delayMs,
      };
    }
    return { status: 200, body: bytes, headers, delayMs };
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
    // A token issued without `admin` or `push` gets the fixture as it is
    if (!credential.admin && !credential.push) return found;
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
        permissions: {
          ...body.permissions,
          ...(credential.admin && { admin: isAdmin, maintain: isAdmin }),
          ...(credential.push && { push: credential.push.has(key) }),
        },
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

  /**
   * The answer of the first `on` route that matches and does not pass. Asked once per request,
   * by {@link builtIn}, which every request that is not refused reaches before the fixtures.
   * @param req The recorded request
   */
  private overrideAnswer(req: RecordedRequest): FakeReply | null {
    const segments = req.path.split('/').slice(1);
    for (const route of this.overrides) {
      const params = match(route, req.method, segments);
      if (!params) continue;
      const { handler } = route;
      const answer = typeof handler === 'function' ? handler(req, params) : handler;
      if (answer) return answer;
    }
    return null;
  }

  /**
   * `GET /search/issues` for `repo:<owner>/<name> type:issue state:<state>`: the count of the
   * issues of `setRepoLists`, pull requests left out, with no items. Null for any other search.
   * @param req The recorded request
   */
  private searchAnswer(req: RecordedRequest): FakeReply | null {
    if (req.method !== 'GET' || req.path !== '/search/issues') return null;
    const terms = new Map(
      (req.query.q ?? '')
        .split(/\s+/)
        .filter((term) => term.includes(':'))
        .map((term) => [term.slice(0, term.indexOf(':')), term.slice(term.indexOf(':') + 1)]),
    );
    const repo = terms.get('repo');
    const issues = repo ? this.repoLists.get(repoKey(repo))?.issues : undefined;
    if (!issues || terms.get('type') !== 'issue') return null;
    const state = terms.get('state');
    const total = issues.filter(
      (item) => !item.pull_request && (state === undefined || item.state === state),
    ).length;
    return { status: 200, body: { total_count: total, incomplete_results: false, items: [] } };
  }

  /**
   * `POST /graphql` for `repository(owner: $owner, name: $name)` with aliased
   * `pullRequest(number: N)` fields: the repository's `databaseId` and the closing references of
   * {@link setClosingReferences}. A credential that does not reach the repository gets
   * `repository: null` and a NOT_FOUND error, with status 200, as GitHub answers. Null for any
   * other request.
   * @param req The recorded request
   * @param credential Who the request authenticated as
   */
  private graphqlAnswer(req: RecordedRequest, credential: Credential): FakeReply | null {
    if (req.method !== 'POST' || req.path !== '/graphql') return null;
    if (credential.kind === 'none') return REQUIRES_AUTH;
    const { query = '', variables = {} } = (req.body ?? {}) as {
      query?: string;
      variables?: { owner?: string; name?: string };
    };
    const fullName = `${variables.owner ?? ''}/${variables.name ?? ''}`;
    const refused = this.refusal('GET', `/repos/${fullName}`, credential);
    const repoId = this.repoIds.get(repoKey(fullName));
    if (refused || repoId === undefined) {
      return {
        status: 200,
        body: {
          data: { repository: null },
          errors: [
            {
              type: 'NOT_FOUND',
              path: ['repository'],
              message: `Could not resolve to a Repository with the name '${fullName}'.`,
            },
          ],
        },
      };
    }
    const repository: Record<string, unknown> = { databaseId: repoId };
    for (const [, alias, number] of query.matchAll(/(\w+)\s*:\s*pullRequest\(number:\s*(\d+)\)/g)) {
      const refs = this.closingRefs.get(`${repoKey(fullName)}#${number}`) ?? [];
      repository[alias] = {
        closingIssuesReferences: {
          totalCount: refs.length,
          nodes: refs.slice(0, 25).map((ref) => ({
            number: ref.number,
            repository: { databaseId: ref.repoId },
          })),
        },
      };
    }
    return { status: 200, body: { data: { repository } } };
  }

  // The fixtures only: the `on` routes were asked in builtIn
  private fromRoutes(req: RecordedRequest): FakeReply {
    const segments = req.path.split('/').slice(1);
    const found = this.fixtures
      .map((route) => ({ route, params: match(route, req.method, segments) }))
      .find((candidate) => candidate.params !== null);
    if (!found?.params) return { status: 404, body: { message: 'Not Found' } };
    const { handler } = found.route;
    const answer = typeof handler === 'function' ? handler(req, found.params) : handler;
    return answer ?? { status: 404, body: { message: 'Not Found' } };
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
