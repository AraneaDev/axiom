/**
 * Client identity for per-IP limits, and the `trust proxy` setting that makes req.ip right.
 */
import { isIPv6 } from 'net';

/**
 * The key per-IP limits use. IPv4 (and IPv4-mapped IPv6) addresses as they are; IPv6
 * addresses by their /64, since one subscriber usually holds a whole /64 and could
 * otherwise rotate addresses for fresh quotas.
 * @param ip - req.ip
 */
export function clientKey(ip: string): string {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return mapped[1];
  if (!isIPv6(ip)) return ip;
  // Expand "::" so the first four groups are the /64
  const [head, tail = ''] = ip.toLowerCase().split('::');
  const headParts = head ? head.split(':') : [];
  const tailParts = tail ? tail.split(':') : [];
  const missing = 8 - headParts.length - tailParts.length;
  const groups = [...headParts, ...Array(Math.max(0, missing)).fill('0'), ...tailParts];
  return `${groups
    .slice(0, 4)
    .map((g) => g.replace(/^0+(?=.)/, ''))
    .join(':')}::/64`;
}

/**
 * Express's `trust proxy` from TRUST_PROXY: a hop count ("1"), "true"/"false", or a list of
 * addresses or ranges ("loopback, uniquelocal"). Unset keeps the old default: one trusted
 * hop in production, none elsewhere. It must match the deployment, or every client shares
 * the proxy's IP (and per-IP limits become global), or clients can spoof their IP.
 * @param raw - process.env.TRUST_PROXY
 * @param nodeEnv - process.env.NODE_ENV
 */
export function parseTrustProxy(
  raw: string | undefined,
  nodeEnv: string | undefined,
): boolean | number | string | undefined {
  if (raw === undefined || raw.trim() === '') return nodeEnv === 'production' ? 1 : undefined;
  const value = raw.trim();
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^\d+$/.test(value)) return Number(value);
  return value;
}
