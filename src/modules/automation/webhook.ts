import dns from 'dns/promises';

const BLOCKED_RANGES = [
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^127\./,
  /^0\./,
  /^169\.254\./,
  /^::1$/,
  /^fc/,
  /^fd/,
  /^fe80/,
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
  data: any,
  method = 'POST',
  headers?: Record<string, string>,
) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') {
    throw new Error('Webhook URLs must use HTTPS');
  }

  const addresses = await dns.resolve4(parsed.hostname);
  for (const addr of addresses) {
    if (BLOCKED_RANGES.some((r) => r.test(addr))) {
      throw new Error('Webhook URL resolves to a private/internal IP');
    }
  }

  await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(10000),
  });
}
