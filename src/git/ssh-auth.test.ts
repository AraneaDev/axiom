import crypto from 'crypto';

import { utils } from 'ssh2';
import { describe, it, expect } from 'vitest';

import { fingerprintOf, verifyPublicKeyAuth } from './ssh-auth';

function keyPair(type: 'ed25519' | 'rsa') {
  const pair =
    type === 'rsa'
      ? utils.generateKeyPairSync('rsa', { bits: 2048 })
      : utils.generateKeyPairSync('ed25519');
  const priv = utils.parseKey(pair.private);
  const pub = utils.parseKey(pair.public);
  if (priv instanceof Error || pub instanceof Error) throw new Error('key parse failed');
  return { publicLine: pair.public, priv, pub };
}

describe('verifyPublicKeyAuth', () => {
  const alice = keyPair('ed25519');
  const mallory = keyPair('ed25519');
  const blob = crypto.randomBytes(64);
  const offered = { algo: alice.pub.type, data: alice.pub.getPublicSSH() };

  it('answers key-ok to a query without a signature', () => {
    expect(verifyPublicKeyAuth({ key: offered }, alice.publicLine)).toBe('key-ok');
  });

  it('authenticates a valid signature', () => {
    const signature = alice.priv.sign(blob);
    expect(verifyPublicKeyAuth({ key: offered, blob, signature }, alice.publicLine)).toBe(
      'authenticated',
    );
  });

  it('rejects a signature made with another private key', () => {
    const signature = mallory.priv.sign(blob);
    expect(verifyPublicKeyAuth({ key: offered, blob, signature }, alice.publicLine)).toBe('reject');
  });

  it('rejects garbage as a signature', () => {
    const signature = crypto.randomBytes(64);
    expect(verifyPublicKeyAuth({ key: offered, blob, signature }, alice.publicLine)).toBe('reject');
  });

  it('rejects when the offered key differs from the stored key', () => {
    const other = { algo: mallory.pub.type, data: mallory.pub.getPublicSSH() };
    expect(verifyPublicKeyAuth({ key: other }, alice.publicLine)).toBe('reject');
  });

  it('rejects a signature without signed data', () => {
    const signature = alice.priv.sign(blob);
    expect(verifyPublicKeyAuth({ key: offered, signature }, alice.publicLine)).toBe('reject');
  });

  it('rejects an unparseable stored key', () => {
    expect(verifyPublicKeyAuth({ key: offered }, 'ssh-ed25519 not-base64')).toBe('reject');
  });

  it('verifies RSA signatures with an explicit hash algorithm', () => {
    const bob = keyPair('rsa');
    const signature = (bob.priv as unknown as { sign(d: Buffer, a: string): Buffer }).sign(
      blob,
      'sha256',
    );
    const key = { algo: bob.pub.type, data: bob.pub.getPublicSSH() };
    expect(verifyPublicKeyAuth({ key, blob, signature, hashAlgo: 'sha256' }, bob.publicLine)).toBe(
      'authenticated',
    );
  });
});

describe('fingerprintOf', () => {
  it('matches the OpenSSH SHA256 fingerprint format', () => {
    const data = Buffer.from('abc');
    const expected = `SHA256:${crypto.createHash('sha256').update(data).digest('base64').replace(/=+$/, '')}`;
    expect(fingerprintOf(data)).toBe(expected);
  });
});
