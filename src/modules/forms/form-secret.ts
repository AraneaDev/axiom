/**
 * Access codes for TOKEN_GATED forms. The server generates them (192 random bits,
 * base64url), stores a SHA-256 digest, and compares in constant time. Codes chosen by users
 * before this (stored as bcrypt hashes, possibly as short as four characters) are treated
 * as unusable until a project admin regenerates the code.
 */
import { createHash, randomBytes, timingSafeEqual } from 'crypto';

const PREFIX = 'sha256:';

/** A fresh access code: 24 random bytes, 32 base64url characters */
export function generateAccessCode(): string {
  return randomBytes(24).toString('base64url');
}

/**
 * The stored form of an access code.
 * @param code
 */
export function hashAccessCode(code: string): string {
  return PREFIX + createHash('sha256').update(code, 'utf8').digest('hex');
}

/**
 * Check a submitted code against the stored one.
 * @param code - What the submitter sent
 * @param stored - The form's stored sharedSecret
 * @returns 'ok', 'wrong', or 'legacy' for a pre-generation code that must be regenerated
 */
export function checkAccessCode(code: string, stored: string): 'ok' | 'wrong' | 'legacy' {
  if (!stored.startsWith(PREFIX)) return 'legacy';
  const expected = Buffer.from(stored.slice(PREFIX.length), 'hex');
  const actual = createHash('sha256').update(code, 'utf8').digest();
  return expected.length === actual.length && timingSafeEqual(expected, actual) ? 'ok' : 'wrong';
}

/**
 * A form as returned to project members: never its stored secret.
 * @param form
 */
export function withoutSecret<T extends { sharedSecret?: string | null }>(
  form: T,
): Omit<T, 'sharedSecret'> {
  const { sharedSecret: _secret, ...rest } = form;
  return rest;
}
