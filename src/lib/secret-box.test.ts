import { randomBytes } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

type SecretBox = typeof import('./secret-box');

const original = { ...process.env };
const keyA = randomBytes(32).toString('base64');
const keyB = randomBytes(32).toString('base64');
const CONTEXT = 'user.twoFactorSecret:41';
const MESSAGE = 'Secret cannot be decrypted with the configured keys';

// The box reads its keys once through env, so each configuration gets fresh modules
async function loadBox(current: string, previous?: string): Promise<SecretBox> {
  vi.resetModules();
  vi.doMock('../config/load-env', () => ({}));
  process.env = { ...original, AXIOM_ENCRYPTION_KEY: current };
  if (previous) process.env.AXIOM_ENCRYPTION_KEY_PREVIOUS = previous;
  else delete process.env.AXIOM_ENCRYPTION_KEY_PREVIOUS;
  return import('./secret-box');
}

function flipByte(part: string): string {
  const bytes = Buffer.from(part, 'base64url');
  bytes[0] ^= 0x01;
  return bytes.toString('base64url');
}

// Each load is a fresh module, so the class is checked by name and reason, not instanceof
function failure(run: () => unknown): { name: string; message: string; reason: string } {
  try {
    run();
  } catch (err) {
    const error = err as Error & { reason: string };
    return { name: error.name, message: error.message, reason: error.reason };
  }
  throw new Error('expected the call to throw');
}

describe('secret box', () => {
  afterEach(() => {
    process.env = { ...original };
    vi.resetModules();
    vi.doUnmock('../config/load-env');
  });

  it('round trips a value in the enc:v1 format', async () => {
    const box = await loadBox(keyA);
    const stored = box.encryptSecret('ghs_example-token', CONTEXT);

    expect(stored).toMatch(/^enc:v1:[0-9a-f]{8}:[\w-]+:[\w-]+:[\w-]*$/);
    expect(stored).not.toContain('ghs_example-token');
    expect(stored).not.toContain(CONTEXT);
    expect(box.isEncrypted(stored)).toBe(true);
    expect(box.decryptSecret(stored, CONTEXT)).toBe('ghs_example-token');
  });

  it('round trips an empty string and unicode', async () => {
    const box = await loadBox(keyA);
    expect(box.decryptSecret(box.encryptSecret('', CONTEXT), CONTEXT)).toBe('');
    expect(box.decryptSecret(box.encryptSecret('sleutel é', CONTEXT), CONTEXT)).toBe('sleutel é');
  });

  it('two encryptions of one value differ', async () => {
    const box = await loadBox(keyA);
    const first = box.encryptSecret('same value', CONTEXT);
    const second = box.encryptSecret('same value', CONTEXT);

    expect(first).not.toBe(second);
    expect(box.decryptSecret(first, CONTEXT)).toBe('same value');
    expect(box.decryptSecret(second, CONTEXT)).toBe('same value');
  });

  it('a value copied to another row does not open under that row context', async () => {
    const box = await loadBox(keyA);
    const stored = box.encryptSecret('JBSWY3DPEHPK3PXP', 'user.twoFactorSecret:41');

    expect(failure(() => box.decryptSecret(stored, 'user.twoFactorSecret:42'))).toEqual({
      name: 'SecretBoxError',
      message: MESSAGE,
      reason: 'auth-failed',
    });
    expect(failure(() => box.decryptSecret(stored, 'githubApp.webhookSecret:41')).reason).toBe(
      'auth-failed',
    );
  });

  it('an empty context is refused on both sides', async () => {
    const box = await loadBox(keyA);
    const stored = box.encryptSecret('value', CONTEXT);

    expect(() => box.encryptSecret('value', '')).toThrow(/context/);
    expect(() => box.decryptSecret(stored, '')).toThrow(/context/);
  });

  it('a flipped ciphertext byte throws auth-failed', async () => {
    const box = await loadBox(keyA);
    const parts = box.encryptSecret('tamper target', CONTEXT).split(':');
    parts[5] = flipByte(parts[5]);

    expect(failure(() => box.decryptSecret(parts.join(':'), CONTEXT))).toEqual({
      name: 'SecretBoxError',
      message: MESSAGE,
      reason: 'auth-failed',
    });
  });

  it('a flipped tag or iv byte throws auth-failed', async () => {
    const box = await loadBox(keyA);
    const stored = box.encryptSecret('tamper target', CONTEXT);
    for (const index of [3, 4]) {
      const parts = stored.split(':');
      parts[index] = flipByte(parts[index]);
      expect(failure(() => box.decryptSecret(parts.join(':'), CONTEXT)).reason).toBe('auth-failed');
    }
  });

  it('a value under the previous key decrypts only while the previous key is configured', async () => {
    const oldBox = await loadBox(keyA);
    const underA = oldBox.encryptSecret('rotated value', CONTEXT);

    const rotated = await loadBox(keyB, keyA);
    expect(rotated.decryptSecret(underA, CONTEXT)).toBe('rotated value');
    expect(rotated.needsReencrypt(underA)).toBe(true);
    expect(rotated.needsReencrypt(rotated.encryptSecret('fresh value', CONTEXT))).toBe(false);

    const dropped = await loadBox(keyB);
    expect(failure(() => dropped.decryptSecret(underA, CONTEXT))).toEqual({
      name: 'SecretBoxError',
      message: MESSAGE,
      reason: 'unknown-key',
    });
  });

  it('the thrown error never contains the plaintext, the stored value or a key', async () => {
    const plaintext = 'super-private-refresh-token';
    const stored = (await loadBox(keyA)).encryptSecret(plaintext, CONTEXT);
    const box = await loadBox(keyB);

    let seen = '';
    try {
      box.decryptSecret(stored, CONTEXT);
    } catch (err) {
      seen = JSON.stringify({ ...(err as object) }) + (err as Error).message + (err as Error).stack;
    }
    expect(seen).toContain(MESSAGE);
    for (const secret of [plaintext, stored, keyA, keyB]) expect(seen).not.toContain(secret);
  });

  it('a value that is not enc:v1 is not encrypted and throws malformed', async () => {
    const box = await loadBox(keyA);

    expect(box.isEncrypted('JBSWY3DPEHPK3PXP')).toBe(false);
    expect(box.isEncrypted('enc:v2:abcdef01:a:b:c')).toBe(false);
    expect(box.needsReencrypt('JBSWY3DPEHPK3PXP')).toBe(false);
    expect(failure(() => box.decryptSecret('JBSWY3DPEHPK3PXP', CONTEXT))).toEqual({
      name: 'SecretBoxError',
      message: MESSAGE,
      reason: 'malformed',
    });
    expect(failure(() => box.decryptSecret('enc:v1:00000000:a:b', CONTEXT)).reason).toBe(
      'malformed',
    );
    const parts = box.encryptSecret('value', CONTEXT).split(':');
    parts[3] = 'AAAA';
    expect(failure(() => box.decryptSecret(parts.join(':'), CONTEXT)).reason).toBe('malformed');
  });
});
