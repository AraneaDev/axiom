import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

import { env } from '../config/env';

// Secrets at rest: AES-256-GCM under the instance key, stored as
// enc:v1:<kid>:<iv>:<tag>:<ciphertext> with base64url parts. The kid names the key a value
// was sealed with, so a value under AXIOM_ENCRYPTION_KEY_PREVIOUS still opens during a
// rotation. Keys are read once here and never logged; no error carries a value.

const PREFIX = 'enc:v1:';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const DECRYPT_ERROR = 'Secret cannot be decrypted with the configured keys';

interface InstanceKey {
  kid: string;
  key: Buffer;
}

function instanceKey(base64: string): InstanceKey {
  const key = Buffer.from(base64, 'base64');
  return { kid: createHash('sha256').update(key).digest('hex').slice(0, 8), key };
}

const currentKey = instanceKey(env.AXIOM_ENCRYPTION_KEY);
const previousKey = env.AXIOM_ENCRYPTION_KEY_PREVIOUS
  ? instanceKey(env.AXIOM_ENCRYPTION_KEY_PREVIOUS)
  : null;

function keyFor(kid: string): InstanceKey | null {
  if (kid === currentKey.kid) return currentKey;
  if (previousKey && kid === previousKey.kid) return previousKey;
  return null;
}

// The prefix and kid are bound as additional data, so a value cannot be relabelled
function additionalData(kid: string): Buffer {
  return Buffer.from(`${PREFIX}${kid}`, 'utf8');
}

/**
 * Seals a value under the current key, with a fresh random IV each time.
 * @param plain The secret to store.
 */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', currentKey.key, iv);
  cipher.setAAD(additionalData(currentKey.kid));
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    'enc',
    'v1',
    currentKey.kid,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join(':');
}

/**
 * Opens a value sealed under the current or the previous key. Any failure (unknown kid,
 * malformed value, failed tag) throws one message that carries no part of the value.
 * @param stored A value encryptSecret produced.
 */
export function decryptSecret(stored: string): string {
  if (!isEncrypted(stored)) throw new Error(DECRYPT_ERROR);
  const parts = stored.split(':');
  if (parts.length !== 6) throw new Error(DECRYPT_ERROR);
  const [, , kid, ivPart, tagPart, ciphertextPart] = parts;
  const key = keyFor(kid);
  if (!key) throw new Error(DECRYPT_ERROR);

  const iv = Buffer.from(ivPart, 'base64url');
  const tag = Buffer.from(tagPart, 'base64url');
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw new Error(DECRYPT_ERROR);

  try {
    const decipher = createDecipheriv('aes-256-gcm', key.key, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(additionalData(kid));
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([
      decipher.update(Buffer.from(ciphertextPart, 'base64url')),
      decipher.final(),
    ]);
    return plain.toString('utf8');
  } catch {
    // The crypto error is dropped on purpose: one message for every failure
    throw new Error(DECRYPT_ERROR);
  }
}

/**
 * Whether a stored value is in the enc:v1 format.
 * @param stored The value as kept in the database.
 */
export function isEncrypted(stored: string): boolean {
  return stored.startsWith(PREFIX);
}

/**
 * True for a value sealed under a key other than the current one. A plaintext value is
 * not encrypted at all: callers check isEncrypted for that.
 * @param stored The value as kept in the database.
 */
export function needsReencrypt(stored: string): boolean {
  if (!isEncrypted(stored)) return false;
  return stored.split(':')[2] !== currentKey.kid;
}
