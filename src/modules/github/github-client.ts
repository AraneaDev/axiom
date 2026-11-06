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
  | { kind: 'none' };

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
type Query = Record<string, string | number>;
type ResolvableKind = Exclude<GithubAuth['kind'], 'none'>;
type Resolver = (auth: GithubAuth) => Promise<string>;

const DEFAULT_TIMEOUT_MS = 10_000;
const TEXT_TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 5;
const API_HEADERS = {
  accept: 'application/vnd.github+json',
  'x-github-api-version': '2022-11-28',
  'user-agent': 'Axiom',
};

let overrideUrls: { api: string; web: string } | null = null;
const resolvers = new Map<ResolvableKind, Resolver>();

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
 */
export function registerGithubAuthResolver(kind: ResolvableKind, resolve: Resolver): void {
  resolvers.set(kind, resolve);
}

/**
 * A URL on GitHub's web host, for links a person opens.
 * @param path A path starting with a slash
 */
export function githubWebUrl(path: string): string {
  return `${webBase()}${checkedPath(path)}`;
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
        path: target.pathname,
        status: timedOut ? 'timeout' : 'unreachable',
      });
      throw githubUnavailable(timedOut ? 'timeout' : 'unreachable');
    }

    const location = response.headers.get('location');
    if (response.status >= 300 && response.status < 400 && location && hop < MAX_REDIRECTS) {
      logger.debug('github request', { method, path: target.pathname, status: response.status });
      await response.body?.cancel();
      target = new URL(location, target);
      withAuth = opts.authAfterRedirect === 'api-host' && target.origin === api;
      // 303, and 301 or 302 after a POST, turn into a GET as browsers do
      if (response.status === 303 || (method === 'POST' && response.status <= 302)) {
        method = 'GET';
        body = undefined;
      }
      continue;
    }

    const level = response.ok ? 'debug' : 'warn';
    logger[level]('github request', { method, path: target.pathname, status: response.status });
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
  const credential = await authorization(auth);
  const response = await send(url, {
    method,
    body: opts.body,
    credential,
    timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    authAfterRedirect: 'api-host',
  });
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
  const credential = await authorization(auth);
  const response = await send(apiUrl(path), {
    method: 'GET',
    credential,
    timeoutMs: TEXT_TIMEOUT_MS,
    authAfterRedirect: 'never',
  });
  if (!response.ok) throw await failure(auth, response, credential);

  const chunks: Buffer[] = [];
  let kept = 0;
  try {
    for await (const chunk of response.body ?? []) {
      chunks.push(Buffer.from(chunk));
      kept += chunk.byteLength;
      while (chunks.length > 1 && kept - chunks[0].byteLength >= maxBytes) {
        kept -= chunks.shift()!.byteLength;
      }
    }
  } catch (error) {
    throw githubUnavailable(isTimeout(error) ? 'timeout' : 'unreadable');
  }
  let tail = Buffer.concat(chunks);
  tail = tail.subarray(Math.max(0, tail.length - maxBytes));
  // Cutting may split a character: drop UTF-8 continuation bytes at the start
  let start = 0;
  while (start < tail.length && start < 3 && (tail[start] & 0xc0) === 0x80) start++;
  return tail.subarray(start).toString('utf8');
}
