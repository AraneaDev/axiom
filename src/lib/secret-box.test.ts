import { randomBytes } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

type SecretBox = typeof import('./secret-box');

const original = { ...process.env };
const keyA = randomBytes(32).toString('base64');
const keyB = randomBytes(32).toString('base64');

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

describe('secret box', () => {
  afterEach(() => {
    process.env = { ...original };
    vi.resetModules();
    vi.doUnmock('../config/load-env');
  });

  it('round trips a value in the enc:v1 format', async () => {
    const box = await loadBox(keyA);
    const stored = box.encryptSecret('ghs_example-token');

    expect(stored).toMatch(/^enc:v1:[0-9a-f]{8}:[\w-]+:[\w-]+:[\w-]*$/);
    expect(stored).not.toContain('ghs_example-token');
    expect(box.isEncrypted(stored)).toBe(true);
    expect(box.decryptSecret(stored)).toBe('ghs_example-token');
  });

  it('round trips an empty string and unicode', async () => {
    const box = await loadBox(keyA);
    expect(box.decryptSecret(box.encryptSecret(''))).toBe('');
    expect(box.decryptSecret(box.encryptSecret('sleutel met accent: é'))).toBe(
      'sleutel met accent: é',
    );
  });

  it('two encryptions of one value differ', async () => {
    const box = await loadBox(keyA);
    const first = box.encryptSecret('same value');
    const second = box.encryptSecret('same value');

    expect(first).not.toBe(second);
    expect(box.decryptSecret(first)).toBe('same value');
    expect(box.decryptSecret(second)).toBe('same value');
  });

  it('a flipped ciphertext byte throws', async () => {
    const box = await loadBox(keyA);
    const parts = box.encryptSecret('tamper target').split(':');
    parts[5] = flipByte(parts[5]);

    expect(() => box.decryptSecret(parts.join(':'))).toThrow(
      'Secret cannot be decrypted with the configured keys',
    );
  });

  it('a flipped tag or iv byte throws', async () => {
    const box = await loadBox(keyA);
    const stored = box.encryptSecret('tamper target');
    for (const index of [3, 4]) {
      const parts = stored.split(':');
      parts[index] = flipByte(parts[index]);
      expect(() => box.decryptSecret(parts.join(':'))).toThrow(
        'Secret cannot be decrypted with the configured keys',
      );
    }
  });

  it('a value under the previous key decrypts only while the previous key is configured', async () => {
    const oldBox = await loadBox(keyA);
    const underA = oldBox.encryptSecret('rotated value');

    const rotated = await loadBox(keyB, keyA);
    expect(rotated.decryptSecret(underA)).toBe('rotated value');
    expect(rotated.needsReencrypt(underA)).toBe(true);
    expect(rotated.needsReencrypt(rotated.encryptSecret('fresh value'))).toBe(false);

    const dropped = await loadBox(keyB);
    expect(() => dropped.decryptSecret(underA)).toThrow(
      'Secret cannot be decrypted with the configured keys',
    );
  });

  it('the thrown message never contains the plaintext or the stored value', async () => {
    const plaintext = 'super-private-refresh-token';
    const stored = (await loadBox(keyA)).encryptSecret(plaintext);
    const box = await loadBox(keyB);

    let message = '';
    try {
      box.decryptSecret(stored);
    } catch (err) {
      message = String((err as Error).message) + String((err as Error).stack);
    }
    expect(message).toContain('Secret cannot be decrypted with the configured keys');
    expect(message).not.toContain(plaintext);
    expect(message).not.toContain(stored);
  });

  it('a value that is not enc:v1 is not encrypted and does not decrypt', async () => {
    const box = await loadBox(keyA);

    expect(box.isEncrypted('JBSWY3DPEHPK3PXP')).toBe(false);
    expect(box.isEncrypted('enc:v2:abcdef01:a:b:c')).toBe(false);
    expect(box.needsReencrypt('JBSWY3DPEHPK3PXP')).toBe(false);
    expect(() => box.decryptSecret('JBSWY3DPEHPK3PXP')).toThrow(
      'Secret cannot be decrypted with the configured keys',
    );
    expect(() => box.decryptSecret('enc:v1:00000000:a:b')).toThrow(
      'Secret cannot be decrypted with the configured keys',
    );
  });
});
