import { env } from '../../config/env';
import { AppError } from '../../middleware/errorHandler';
import { logger } from '../../utils/logger';

import { githubError, githubUnavailable } from './github-errors';

/**
 * Who a call is made as: the App itself (JWT), one of its installations, a connected user,
 * or nobody (the manifest conversion and the OAuth endpoints carry their own credentials).
 */
export type GithubAuth =
  | { kind: 'app' }
  | { kind: 'installation'; installationId: number }
  | { kind: 'user'; userId: string }
  /** The App's client credentials as Basic auth, for the endpoints of its OAuth side */
  | { kind: 'oauth-app' }
  /** A token in hand that is not stored yet: the one a connection has just been given */
  | { kind: 'token'; token: string }
  | { kind: 'none' };

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
type Query = Record<string, string | number>;
type ResolvableKind = Exclude<GithubAuth['kind'], 'none' | 'token'>;
type Resolver = (auth: GithubAuth) => Promise<string>;
/**
 * Gives a new Authorization value after GitHub refused the one that was sent (401). It is told
 * the value that was refused, so callers refused together can share one new credential.
 */
type Refresher = (auth: GithubAuth, refused: string) => Promise<string>;

const DEFAULT_TIMEOUT_MS = 10_000;
const TEXT_TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 5;
const API_HEADERS = {
  accept: 'application/vnd.github+json',
  'x-github-api-version': '2022-11-28',
  'user-agent': 'Axiom',
};

let overrideUrls: { api: string; web: string } | null = null;
// Responses that went out with the credential attached and are the final answer of their chain
const credentialed = new WeakSet<Response>();
const resolvers = new Map<ResolvableKind, Resolver>();
const refreshers = new Map<ResolvableKind, Refresher>();

const trimSlash = (url: string) => url.replace(/\/+$/, '');
const apiBase = () => trimSlash(overrideUrls?.api ?? env.GITHUB_API_URL);
const webBase = () => trimSlash(overrideUrls?.web ?? env.GITHUB_WEB_URL);

/**
 * Points the client at a test double. Tests only.
 * @param urls The API and web bases, or null for the configured ones
 */
export function setGithubBaseUrls(urls: { api: string; web: string } | null): void {
  if (env.NODE_ENV !== 'test') throw new Error('setGithubBaseUrls is for tests only');
  overrideUrls = urls;
}

/**
 * Registers how one kind of auth turns into an Authorization header value. The App module
 * registers `app` and `installation`, connected accounts register `user`.
 * @param kind The auth kind this resolver serves
 * @param resolve Gives the full header value, such as `token ghs_...`
 * @param refresh
 */
export function registerGithubAuthResolver(
  kind: ResolvableKind,
  resolve: Resolver,
  refresh?: Refresher,
): void {
  resolvers.set(kind, resolve);
  if (refresh) refreshers.set(kind, refresh);
}

/** The auth kinds that have a resolver in this process */
export function registeredGithubAuthKinds(): string[] {
  return [...resolvers.keys()];
}

/**
 * The origin of GitHub's web host, for the CSP form-action that lets the manifest form post there.
 * @returns The origin, such as https://github.com
 */
export function githubWebOrigin(): string {
  return new URL(webBase()).origin;
}

/**
 * A URL on GitHub's web host, for links a person opens.
 * @param path A path starting with a slash
 */
export function githubWebUrl(path: string): string {
  return `${webBase()}${checkedPath(path)}`;
}

/**
 * One POST to GitHub's web host, for the OAuth token endpoint, which answers 200 with an `error`
 * in the body for most refusals. Nothing is sent in the URL, redirects are not followed, and
 * the log gets method, path and status only. The caller reads the answer.
 * @param path A path starting with a slash, such as `/login/oauth/access_token`
 * @param body The JSON body, which holds the credentials
 * @param timeoutMs The most to wait (default 10 s)
 * @returns GitHub's status and its parsed JSON body (null when it is not JSON)
 */
export async function githubWebPost(
  path: string,
  body: Record<string, string>,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<{ status: number; data: unknown }> {
  const url = new URL(githubWebUrl(path));
  const signal = AbortSignal.timeout(timeoutMs);
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      // Without this the token endpoint answers form-encoded, not JSON
      headers: { ...API_HEADERS, accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify(body),
      redirect: 'manual',
      signal,
    });
  } catch {
    const timedOut = signal.aborted;
    logger.warn('github request failed', {
      method: 'POST',
      path: url.pathname,
      status: timedOut ? 'timeout' : 'unreachable',
    });
    throw githubUnavailable(timedOut ? 'timeout' : 'unreachable');
  }
  logger[response.ok ? 'debug' : 'warn']('github request', {
    method: 'POST',
    path: url.pathname,
    status: response.status,
  });
  let data: unknown = null;
  try {
    const text = await response.text();
    data = text ? JSON.parse(text) : null;
  } catch {
    // A body that is not JSON is no answer to read: the status decides
  }
  return { status: response.status, data };
}

/**
 * A path to put after a base URL. Only `/` followed by something other than `/` is one:
 * anything else (`@host/x`, `//host/x`, an absolute URL) could name another host, and the
 * credential would follow it there.
 * @param path The path a caller gave
 */
function checkedPath(path: string): string {
  if (!/^\/(?!\/)/.test(path)) throw new Error('A GitHub path must start with a single "/"');
  return path;
}

/** The API host: the only one a credential is ever sent to */
const apiOrigin = () => new URL(apiBase()).origin;

async function authorization(auth: GithubAuth): Promise<string | undefined> {
  if (auth.kind === 'none') return undefined;
  if (auth.kind === 'token') return `token ${auth.token}`;
  const resolve = resolvers.get(auth.kind);
  if (!resolve) {
    throw new AppError(502, 'GitHub is not set up on this instance.', 'GITHUB_APP_AUTH');
  }
  return resolve(auth);
}

function apiUrl(path: string, query?: Query): URL {
  const url = new URL(`${apiBase()}${checkedPath(path)}`);
  if (url.origin !== apiOrigin()) throw new Error('A GitHub path must stay on the API host');
  for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, String(value));
  return url;
}

interface SendOptions {
  method: Method;
  body?: unknown;
  credential?: string;
  timeoutMs: number;
  /**
   * Send the credential after a redirect: only to the API host, or never. The first request
   * carries it only when it goes to the API host.
   */
  authAfterRedirect: 'api-host' | 'never';
}

/**
 * A path for the log. A manifest code is a bearer credential for the App's secrets until it is
 * used, so it never reaches a log line.
 * @param pathname The request path
 */
function loggablePath(pathname: string): string {
  return pathname.replace(/\/app-manifests\/[^/]+/gi, '/app-manifests/[redacted]');
}

/**
 * One call with redirects followed by hand, so the credential never travels to a host it was
 * not meant for. The log gets method, path and status only.
 * @param url The first URL, on the API host
 * @param opts Method, body, credential, timeout and the redirect rule for the credential
 */
async function send(url: URL, opts: SendOptions): Promise<Response> {
  const signal = AbortSignal.timeout(opts.timeoutMs);
  const api = apiOrigin();
  let target = url;
  let method: Method = opts.method;
  let body = opts.body;
  let withAuth = target.origin === api;
  let leftApi = !withAuth;

  for (let hop = 0; ; hop++) {
    const headers: Record<string, string> = { ...API_HEADERS };
    if (opts.credential && withAuth) headers.authorization = opts.credential;
    if (body !== undefined) headers['content-type'] = 'application/json';

    let response: Response;
    try {
      response = await fetch(target, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'manual',
        signal,
      });
    } catch {
      const timedOut = signal.aborted;
      logger.warn('github request failed', {
        method,
        path: loggablePath(target.pathname),
        status: timedOut ? 'timeout' : 'unreachable',
      });
      throw githubUnavailable(timedOut ? 'timeout' : 'unreachable');
    }

    const location = response.headers.get('location');
    if (response.status >= 300 && response.status < 400 && location && hop < MAX_REDIRECTS) {
      logger.debug('github request', {
        method,
        path: loggablePath(target.pathname),
        status: response.status,
      });
      await response.body?.cancel();
      target = new URL(location, target);
      // 303, and 301 or 302 after a POST, turn into a GET as browsers do
      if (response.status === 303 || (method === 'POST' && response.status <= 302)) {
        method = 'GET';
        body = undefined;
      }
      if (target.origin !== api) {
        // A 307 or 308 repeats the request, body and all: never to another host
        if (response.status === 307 || response.status === 308 || body !== undefined) {
          throw githubUnavailable('redirected-off-host');
        }
        leftApi = true;
      }
      // Once the chain has left the API host, nothing after it gets the token, even back there
      withAuth = opts.authAfterRedirect === 'api-host' && !leftApi;
      continue;
    }

    const level = response.ok ? 'debug' : 'warn';
    logger[level]('github request', {
      method,
      path: loggablePath(target.pathname),
      status: response.status,
    });
    if (opts.credential && withAuth) credentialed.add(response);
    return response;
  }
}

const isTimeout = (error: unknown) =>
  error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');

/**
 * A success body: JSON when GitHub says it is JSON, text otherwise. A body that breaks off or
 * does not parse is an error that says so.
 * @param response GitHub's answer
 */
async function successBody(response: Response): Promise<unknown> {
  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    throw githubUnavailable(isTimeout(error) ? 'timeout' : 'unreadable');
  }
  if (!text) return null;
  if (!(response.headers.get('content-type') ?? '').includes('json')) return text;
  try {
    return JSON.parse(text);
  } catch {
    throw githubUnavailable('unreadable');
  }
}

async function failure(auth: GithubAuth, response: Response, credential?: string) {
  let body: unknown = null;
  try {
    const text = await response.text();
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
  } catch {
    // The status alone decides the error
  }
  return githubError(auth.kind, response.status, response.headers, body, credential);
}

async function request<T>(
  auth: GithubAuth,
  method: Method,
  url: URL,
  opts: { body?: unknown; timeoutMs?: number },
): Promise<{ status: number; data: T; headers: Headers }> {
  let credential = await authorization(auth);
  const attempt = () =>
    send(url, {
      method,
      body: opts.body,
      credential,
      timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      authAfterRedirect: 'api-host',
    });
  let response = await attempt();
  // A token GitHub refuses may only have been revoked early: renew it once and try again
  const refresh =
    auth.kind === 'none' || auth.kind === 'token' ? undefined : refreshers.get(auth.kind);
  // Only a 401 from the API host, to a request that carried the token, says anything about it
  if (response.status === 401 && refresh && credential && credentialed.has(response)) {
    await response.body?.cancel();
    credential = await refresh(auth, credential);
    response = await attempt();
  }
  if (!response.ok) throw await failure(auth, response, credential);
  const data = await successBody(response);
  return { status: response.status, data: data as T, headers: response.headers };
}

/**
 * One GitHub REST call. Every GitHub API call in Axiom goes through this module.
 * @param auth Who the call is made as
 * @param method The HTTP method
 * @param path The API path, such as `/repos/acme-labs/widget`
 * @param opts Query, JSON body and timeout (default 10 s)
 * @param opts.query
 * @param opts.body
 * @param opts.timeoutMs
 */
export async function githubRequest<T>(
  auth: GithubAuth,
  method: Method,
  path: string,
  opts: { query?: Query; body?: unknown; timeoutMs?: number } = {},
): Promise<{ status: number; data: T; headers: Headers }> {
  return request<T>(auth, method, apiUrl(path, opts.query), opts);
}

/**
 * The `rel="next"` target of a Link header
 * @param link
 */
function nextLink(link: string | null): string | null {
  if (!link) return null;
  for (const part of link.split(',')) {
    const match = /<([^>]+)>\s*;\s*rel="next"/.exec(part);
    if (match) return match[1];
  }
  return null;
}

/**
 * Every page of a GitHub list, up to `maxPages` pages of 100.
 * @param auth Who the calls are made as
 * @param path The list's API path
 * @param opts Query, page cap, and the key holding the items when GitHub wraps the list
 * @param opts.query
 * @param opts.maxPages
 * @param opts.itemsKey
 * @returns The items, and whether the list was read to its end
 */
export async function githubPaginate<T>(
  auth: GithubAuth,
  path: string,
  opts: { query?: Query; maxPages: number; itemsKey?: string },
): Promise<{ items: T[]; complete: boolean }> {
  const items: T[] = [];
  let url: URL | null = apiUrl(path, { ...opts.query, per_page: 100 });

  for (let page = 0; url && page < opts.maxPages; page++) {
    const { data, headers }: { data: unknown; headers: Headers } = await request<unknown>(
      auth,
      'GET',
      url,
      {},
    );
    const list = opts.itemsKey ? (data as Record<string, unknown> | null)?.[opts.itemsKey] : data;
    if (Array.isArray(list)) items.push(...(list as T[]));
    const next = nextLink(headers.get('link'));
    url = next ? new URL(next, url) : null;
    // The next page carries the credential, so it has to be on the API host
    if (url && url.origin !== apiOrigin()) throw githubUnavailable('off-host');
  }
  return { items, complete: url === null };
}

/**
 * A text download, such as a job log: GitHub answers with a redirect to storage, which is
 * followed without the Authorization header. The body is streamed and only its last
 * `maxBytes` are kept.
 * @param auth Who the call is made as
 * @param path The API path that redirects to the text
 * @param maxBytes The most bytes to keep, counted from the end
 */
export async function githubText(
  auth: GithubAuth,
  path: string,
  maxBytes: number,
): Promise<string> {
  let credential = await authorization(auth);
  const url = apiUrl(path);
  const attempt = () =>
    send(url, {
      method: 'GET',
      credential,
      timeoutMs: TEXT_TIMEOUT_MS,
      authAfterRedirect: 'never',
    });
  let response = await attempt();
  // As in `request`: a 401 from the API host to a request that carried the token is renewed once
  const refresh =
    auth.kind === 'none' || auth.kind === 'token' ? undefined : refreshers.get(auth.kind);
  if (response.status === 401 && refresh && credential && credentialed.has(response)) {
    await response.body?.cancel();
    credential = await refresh(auth, credential);
    response = await attempt();
  }
  if (!response.ok) throw await failure(auth, response, credential);

  // A rolling window: the head of what has arrived is trimmed away as soon as the rest fits the
  // cap, so no more than `maxBytes` and the chunk being read are ever held
  const chunks: Buffer[] = [];
  let kept = 0;
  try {
    for await (const chunk of response.body ?? []) {
      const bytes = Buffer.from(chunk);
      chunks.push(bytes);
      kept += bytes.byteLength;
      while (kept > maxBytes) {
        const excess = kept - maxBytes;
        if (chunks[0].byteLength <= excess) {
          kept -= chunks.shift()!.byteLength;
        } else {
          chunks[0] = chunks[0].subarray(excess);
          kept -= excess;
        }
      }
    }
  } catch (error) {
    throw githubUnavailable(isTimeout(error) ? 'timeout' : 'unreadable');
  }
  const tail = Buffer.concat(chunks);
  // Cutting may split a character: drop UTF-8 continuation bytes at the start
  let start = 0;
  while (start < tail.length && start < 3 && (tail[start] & 0xc0) === 0x80) start++;
  return tail.subarray(start).toString('utf8');
}
