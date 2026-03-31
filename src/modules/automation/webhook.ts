import dns from 'dns/promises';

const BLOCKED_IPV4_RANGES = [
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^127\./,
  /^0\./,
  /^169\.254\./,
];

const BLOCKED_IPV6_RANGES = [
  /^::1$/, // loopback
  /^fe80:/i, // link-local (fe80::/10)
  /^f[cd]/i, // unique local (fc00::/7 covers fc and fd)
  /^::ffff:\d+\.\d+/i, // IPv4-mapped (::ffff:0:0/96)
];

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
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') {
    throw new Error('Webhook URLs must use HTTPS');
  }

  const [ipv4Addresses, ipv6Addresses] = await Promise.all([
    dns.resolve4(parsed.hostname).catch(() => [] as string[]),
    dns.resolve6(parsed.hostname).catch(() => [] as string[]),
  ]);

  if (ipv4Addresses.length === 0 && ipv6Addresses.length === 0) {
    throw new Error('Webhook URL does not resolve to any address');
  }

  for (const addr of ipv4Addresses) {
    if (BLOCKED_IPV4_RANGES.some((r) => r.test(addr))) {
      throw new Error('Webhook URL resolves to a private/internal IP');
    }
  }

  for (const addr of ipv6Addresses) {
    if (BLOCKED_IPV6_RANGES.some((r) => r.test(addr))) {
      throw new Error('Webhook URL resolves to a private/internal IPv6 address');
    }
  }

  await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(10000),
  });
}
