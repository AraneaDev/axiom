import { createHmac } from 'crypto';

import { describe, it, expect, vi } from 'vitest';

vi.mock('crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('crypto')>();
  return { ...actual, timingSafeEqual: vi.fn(actual.timingSafeEqual) };
});

const { timingSafeEqual } = await import('crypto');
const { signatureHeader, verifySignature } = await import('./sign');

const SECRET = 'whsec_test';
const BODY = '{"a":1}';
const T = 1700000000;

describe('bot event signing', () => {
  it('the header matches a known vector', () => {
    const expected = createHmac('sha256', 'whsec_test').update('1700000000.{"a":1}').digest('hex');
    expect(signatureHeader(SECRET, BODY, T)).toBe(`t=1700000000,v1=${expected}`);
    expect(verifySignature(SECRET, BODY, signatureHeader(SECRET, BODY, T), T)).toBe(true);
  });

  it('verify refuses a changed body', () => {
    const header = signatureHeader(SECRET, BODY, T);
    expect(verifySignature(SECRET, '{"a":2}', header, T)).toBe(false);
    expect(verifySignature('whsec_other', BODY, header, T)).toBe(false);
  });

  it('verify refuses a timestamp outside 300 s', () => {
    const header = signatureHeader(SECRET, BODY, T);
    expect(verifySignature(SECRET, BODY, header, T + 300)).toBe(true);
    expect(verifySignature(SECRET, BODY, header, T - 300)).toBe(true);
    expect(verifySignature(SECRET, BODY, header, T + 301)).toBe(false);
    expect(verifySignature(SECRET, BODY, header, T - 301)).toBe(false);
    expect(verifySignature(SECRET, BODY, header, T + 3600, 3600)).toBe(true);
  });

  it('verify uses a constant-time compare', () => {
    const header = signatureHeader(SECRET, BODY, T);
    vi.mocked(timingSafeEqual).mockClear();
    expect(verifySignature(SECRET, BODY, header, T)).toBe(true);
    expect(timingSafeEqual).toHaveBeenCalledTimes(1);
    const wrong = header.replace(/v1=./, (m) => (m.endsWith('0') ? 'v1=1' : 'v1=0'));
    expect(verifySignature(SECRET, BODY, wrong, T)).toBe(false);
    expect(timingSafeEqual).toHaveBeenCalledTimes(2);
    // A malformed header never reaches the compare
    expect(verifySignature(SECRET, BODY, 'v1=zz', T)).toBe(false);
    expect(timingSafeEqual).toHaveBeenCalledTimes(2);
  });
});
