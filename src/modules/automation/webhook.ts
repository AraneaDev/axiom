import { lookup as dnsLookup, type LookupAddress } from 'dns';
import dns from 'dns/promises';
import type { IncomingMessage } from 'http';
import https from 'https';
import net from 'net';

import { AppError } from '../../middleware/errorHandler';

// Two lists: within one, a rule on ::ffff:0:0/96 would match every IPv4 address as well
const BLOCKED_IPV4 = new net.BlockList();
const BLOCKED_IPV6 = new net.BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // shared address space (carrier NAT)
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // link-local, including cloud metadata
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15], // benchmarking
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved and broadcast
] as const) {
  BLOCKED_IPV4.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::', 96], // unspecified, loopback and IPv4-compatible, which can embed a private address
  ['::ffff:0:0', 96], // IPv4-mapped
  ['64:ff9b::', 96], // NAT64, can embed a private IPv4 address
  ['64:ff9b:1::', 48], // local-use NAT64, same
  ['100::', 64], // discard
  ['2001::', 32], // Teredo, same
  ['2002::', 16], // 6to4, same
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['fec0::', 10], // site-local
  ['ff00::', 8], // multicast
] as const) {
  BLOCKED_IPV6.addSubnet(network, prefix, 'ipv6');
}

/**
 * Whether an address is one the server must not connect to on a user's behalf. Anything that
 * doesn't parse as an address counts as blocked.
 * @param address - An IPv4 or IPv6 address
 */
export function isBlockedAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 0) return true;
  return family === 4 ? BLOCKED_IPV4.check(address, 'ipv4') : BLOCKED_IPV6.check(address, 'ipv6');
}

/**
 * Check a URL before the server connects to it: HTTPS, no credentials, and a host that is not and
 * does not resolve to a private address. This only checks the moment of asking, so a host can
 * still resolve elsewhere when the connection is made; publicLookup closes that gap for a client
 * that can use it.
 * @param url - The URL
 * @param label - How messages name the URL
 * @throws {AppError} 400 when the URL is refused
 */
export async function assertPublicUrl(url: string, label = 'Webhook'): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new AppError(400, `${label} URL is not valid`);
  }
  if (parsed.protocol !== 'https:') {
    throw new AppError(400, `${label} URLs must use HTTPS`);
  }
  if (parsed.username || parsed.password) {
    throw new AppError(400, `${label} URLs must not contain credentials`);
  }

  // A literal address is connected to directly: neither DNS nor a lookup function sees it
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  const literal = net.isIP(host) !== 0;
  const [ipv4Addresses, ipv6Addresses] = literal
    ? [net.isIPv4(host) ? [host] : [], net.isIPv6(host) ? [host] : []]
    : await Promise.all([
        dns.resolve4(host).catch(() => [] as string[]),
        dns.resolve6(host).catch(() => [] as string[]),
      ]);

  if (ipv4Addresses.length === 0 && ipv6Addresses.length === 0) {
    throw new AppError(400, `${label} URL does not resolve to any address`);
  }
  if (ipv4Addresses.some(isBlockedAddress)) {
    throw new AppError(400, `${label} URL resolves to a private/internal IP`);
  }
  if (ipv6Addresses.some(isBlockedAddress)) {
    throw new AppError(400, `${label} URL resolves to a private/internal IPv6 address`);
  }
}

/**
 * A lookup function for `https.request` that refuses private addresses, so the address that gets
 * checked is the address that gets connected to: a host can't answer differently the second time.
 * Fails with the code ERR_BLOCKED_ADDRESS.
 * @param hostname - The host
 * @param options - As for dns.lookup
 * @param callback - As for dns.lookup
 */
export const publicLookup: net.LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses: LookupAddress[]) => {
    if (err) {
      callback(err, '', 0);
      return;
    }
    if (addresses.length === 0 || addresses.some(({ address }) => isBlockedAddress(address))) {
      const blocked: NodeJS.ErrnoException = new Error(`${hostname} resolves to a private address`);
      blocked.code = 'ERR_BLOCKED_ADDRESS';
      callback(blocked, '', 0);
      return;
    }
    if (options.all) {
      // Node's own signature for { all: true } differs from the one LookupFunction declares
      (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, addresses);
    } else {
      callback(null, addresses[0].address, addresses[0].family);
    }
  });
};

const MAX_REDIRECTS = 5;

/** A request to a URL outside this server. */
export interface PublicRequest {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal: AbortSignal;
}

/** What openPublicUrl uses; tests replace the network. */
export interface PublicRequestDeps {
  /** Refuses a URL with an AppError. Runs for the first URL and every redirect. */
  checkUrl: (url: string) => Promise<void>;
  /** Connects, and resolves when the response headers are in. */
  open: (url: URL, request: PublicRequest) => Promise<IncomingMessage>;
}

// publicLookup: the address checked is the address connected to, so a host can't pass checkUrl and
// then resolve to something private (DNS rebinding)
const openPinned: PublicRequestDeps['open'] = (url, { method, headers, body, signal }) =>
  new Promise((resolve, reject) => {
    https
      .request(url, { method, headers, signal, lookup: publicLookup, agent: false }, resolve)
      .on('error', reject)
      .end(body);
  });

/** The statuses the Fetch standard follows; any other 3xx is an answer like any other. */
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** What describes a body, so it goes when the body does: the Fetch list, plus the length. */
const BODY_HEADERS = new Set([
  'content-encoding',
  'content-language',
  'content-location',
  'content-type',
  'content-length',
]);

/**
 * The request a redirect leads to, by the Fetch standard's HTTP-redirect fetch: a 301 or 302 turns
 * a POST into a GET, a 303 does so for anything but a GET or HEAD, and otherwise the request is
 * repeated. Another origin doesn't get the caller's other headers: Fetch drops Authorization, and
 * any of these can hold a secret for the first origin.
 * @param request - The request that was redirected
 * @param status - The redirect's status
 * @param sameOrigin - Whether the redirect stays on the origin
 */
function redirectedRequest(
  request: PublicRequest,
  status: number,
  sameOrigin: boolean,
): PublicRequest {
  const method = (request.method ?? 'GET').toUpperCase();
  const becomesGet =
    ((status === 301 || status === 302) && method === 'POST') ||
    (status === 303 && method !== 'GET' && method !== 'HEAD');
  const headers = Object.entries(request.headers ?? {}).filter(([name]) =>
    BODY_HEADERS.has(name.toLowerCase()) ? !becomesGet : sameOrigin,
  );
  return {
    ...request,
    method: becomesGet ? 'GET' : request.method,
    body: becomesGet ? undefined : request.body,
    headers: Object.fromEntries(headers),
  };
}

/**
 * Send a request to a URL a user gave, following redirects: each hop passes the guard and connects
 * through the pinned lookup. The caller reads or destroys the response it gets.
 * @param url - The URL
 * @param request - The request
 * @param label - How messages name the URL
 * @param deps - Replaceable dependencies (tests)
 * @returns The first response that isn't a redirect
 * @throws {AppError} 400 for a refused address, a bad redirect or too many of them
 */
export async function openPublicUrl(
  url: string,
  request: PublicRequest,
  label: string,
  deps: Partial<PublicRequestDeps> = {},
): Promise<IncomingMessage> {
  const checkUrl = deps.checkUrl ?? ((target: string) => assertPublicUrl(target, label));
  const open = deps.open ?? openPinned;
  let current = url;
  let currentRequest = request;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await checkUrl(current);
    let res: IncomingMessage;
    try {
      res = await open(new URL(current), currentRequest);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ERR_BLOCKED_ADDRESS') {
        throw new AppError(400, `${label} URL resolves to a private/internal IP`);
      }
      throw err;
    }
    const status = res.statusCode ?? 0;
    const location = res.headers.location;
    if (!REDIRECT_STATUSES.has(status) || !location) return res;
    res.destroy();

    let next: URL;
    try {
      next = new URL(location, current);
    } catch {
      throw new AppError(400, `${label} URL redirected to an invalid URL`);
    }
    currentRequest = redirectedRequest(
      currentRequest,
      status,
      next.origin === new URL(current).origin,
    );
    current = next.href;
  }
  throw new AppError(400, `${label} URL redirected too many times`);
}

const WEBHOOK_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']);

/**
 * Whether a webhook can use this method. An HTTP client sends whatever it gets, TRACE included,
 * and reads an empty method as GET.
 * @param method - The method, in any case; rules are stored as JSON, so it can be anything
 */
export function isWebhookMethod(method: unknown): method is string {
  return typeof method === 'string' && WEBHOOK_METHODS.has(method.toUpperCase());
}

/**
 * Headers an HTTP client decides for itself. Hop-by-hop ones describe this one connection: set by
 * hand, a Transfer-Encoding beside the explicit Content-Length makes a request a server refuses,
 * and Host would address another site at the checked address.
 */
const CLIENT_HEADERS = new Set([
  'connection',
  'content-length',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

/**
 * Send an automation's webhook. The response is not read: only that it was delivered counts.
 * @param url - The URL
 * @param data - What to send as JSON
 * @param method - The HTTP method
 * @param headers - Extra headers
 * @param deps - Replaceable dependencies (tests)
 * @throws {AppError} 400 for a method that isn't allowed, and as openPublicUrl
 */
export async function executeWebhook(
  url: string,
  data: Record<string, unknown>,
  method = 'POST',
  headers?: Record<string, string>,
  deps: Partial<PublicRequestDeps> = {},
) {
  if (!isWebhookMethod(method)) {
    throw new AppError(400, 'Webhook method is not allowed');
  }
  const upperMethod = method.toUpperCase();
  // A GET or HEAD has no body. The length is explicit: without it, HTTP clients drop a DELETE's
  const body = upperMethod === 'GET' || upperMethod === 'HEAD' ? undefined : JSON.stringify(data);
  const res = await openPublicUrl(
    url,
    {
      method: upperMethod,
      headers: {
        'Content-Type': 'application/json',
        ...Object.fromEntries(
          Object.entries(headers ?? {}).filter(([name]) => !CLIENT_HEADERS.has(name.toLowerCase())),
        ),
        ...(body === undefined ? {} : { 'Content-Length': String(Buffer.byteLength(body)) }),
      },
      body,
      signal: AbortSignal.timeout(10000),
    },
    'Webhook',
    deps,
  );
  res.destroy();
}
