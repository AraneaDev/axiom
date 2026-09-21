import crypto from 'crypto';

import { utils } from 'ssh2';

export interface PublicKeyAuthInput {
  key: { algo: string; data: Buffer };
  signature?: Buffer;
  blob?: Buffer;
  hashAlgo?: string;
}

/**
 * - `reject`: wrong key or bad signature
 * - `key-ok`: the key is registered; the client has not signed yet
 * - `authenticated`: the client proved possession of the private key
 */
export type PublicKeyAuthResult = 'reject' | 'key-ok' | 'authenticated';

/**
 * OpenSSH-style SHA256 fingerprint of a public key blob.
 * @param keyData - Raw public key blob
 * @returns `SHA256:<base64 without padding>`
 */
export function fingerprintOf(keyData: Buffer): string {
  const hash = crypto.createHash('sha256').update(keyData).digest('base64');
  return `SHA256:${hash.replace(/=+$/, '')}`;
}

/**
 * Decide an SSH public-key authentication attempt against the key stored for the user.
 * A request without a signature is only a query and never authenticates.
 * @param input - Key, signature and signed data from the ssh2 auth context
 * @param storedPublicKey - The OpenSSH public key line stored for the matching fingerprint
 * @returns The auth decision
 */
export function verifyPublicKeyAuth(
  input: PublicKeyAuthInput,
  storedPublicKey: string,
): PublicKeyAuthResult {
  const parsed = utils.parseKey(storedPublicKey);
  if (parsed instanceof Error) return 'reject';

  const expected = parsed.getPublicSSH();
  const offered = input.key.data;
  if (expected.length !== offered.length || !crypto.timingSafeEqual(expected, offered)) {
    return 'reject';
  }

  if (!input.signature) return 'key-ok';
  if (!input.blob) return 'reject';

  return parsed.verify(input.blob, input.signature, input.hashAlgo) === true
    ? 'authenticated'
    : 'reject';
}
