import { lookup as dnsLookup, type LookupAddress } from 'dns';
import dns from 'dns/promises';
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
  ['::', 128],
  ['::1', 128],
  ['::ffff:0:0', 96], // IPv4-mapped
  ['64:ff9b::', 96], // NAT64, can embed a private IPv4 address
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

/**
 *
 * @param url
 * @param data
 * @param method
 * @param headers
 */
export async function executeWebhook(
  url: string,
  data: Record<string, unknown>,
  method = 'POST',
  headers?: Record<string, string>,
) {
  await assertPublicUrl(url);

  await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(10000),
  });
}
