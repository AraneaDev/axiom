/**
 * The signature a bot uses to know an event came from Axiom:
 * `Axiom-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">`.
 */
import { createHmac, timingSafeEqual } from 'crypto';

const HEX_SHA256 = /^[0-9a-f]{64}$/;

/**
 * The hex HMAC-SHA256 of `"<t>.<body>"`.
 * @param secret - The webhook's signing secret
 * @param body - The exact body sent
 * @param t - Unix seconds
 */
function digest(secret: string, body: string, t: number): string {
  return createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
}

/**
 * The value of the Axiom-Signature header for a body sent now.
 * @param secret - The webhook's signing secret
 * @param body - The exact body sent
 * @param nowSeconds - The time in unix seconds
 */
export function signatureHeader(secret: string, body: string, nowSeconds: number): string {
  const t = Math.floor(nowSeconds);
  return `t=${t},v1=${digest(secret, body, t)}`;
}

/**
 * Whether an Axiom-Signature header signs this body with this secret, within the tolerance of
 * the given time. The comparison takes constant time.
 * @param secret - The webhook's signing secret
 * @param body - The exact body received
 * @param header - The header's value
 * @param nowSeconds - The time in unix seconds
 * @param toleranceSeconds - How far the header's time may be from now
 */
export function verifySignature(
  secret: string,
  body: string,
  header: string,
  nowSeconds: number,
  toleranceSeconds = 300,
): boolean {
  let t: number | null = null;
  const signatures: string[] = [];
  for (const part of header.split(',')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === 't' && /^\d+$/.test(value)) t = Number(value);
    if (key === 'v1' && HEX_SHA256.test(value)) signatures.push(value);
  }
  if (t === null || signatures.length === 0) return false;
  if (Math.abs(nowSeconds - t) > toleranceSeconds) return false;
  const expected = Buffer.from(digest(secret, body, t), 'hex');
  let ok = false;
  for (const signature of signatures) {
    if (timingSafeEqual(expected, Buffer.from(signature, 'hex'))) ok = true;
  }
  return ok;
}
