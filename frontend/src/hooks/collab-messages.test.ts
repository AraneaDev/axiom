import { describe, it, expect } from 'vitest';

import { parseAccess, parseExternalChange, parseLock, readJsonPayload } from './collab-messages';

/**
 * Encode a varUint type followed by a varString, as the server's encodeJsonMessage does
 * @param type
 * @param payload
 */
function encode(type: number, payload?: unknown): Uint8Array {
  const bytes: number[] = [type];
  if (payload !== undefined) {
    const text = new TextEncoder().encode(JSON.stringify(payload));
    let n = text.length;
    while (n >= 0x80) {
      bytes.push((n & 0x7f) | 0x80);
      n = Math.floor(n / 0x80);
    }
    bytes.push(n);
    bytes.push(...text);
  }
  return new Uint8Array(bytes);
}

describe('collab messages', () => {
  it('reads a JSON payload after the type', () => {
    const decoder = { arr: encode(20, { state: 'resolved', byName: 'Tim' }), pos: 1 };
    expect(parseExternalChange(readJsonPayload(decoder))).toEqual({
      state: 'resolved',
      byName: 'Tim',
    });
    expect(decoder.pos).toBe(decoder.arr.length);
  });

  it('tolerates a bare message with no payload bytes', () => {
    expect(readJsonPayload({ arr: encode(21), pos: 1 })).toBeNull();
  });

  it('reads a payload longer than 127 bytes', () => {
    const long = 'x'.repeat(500);
    const decoder = { arr: encode(20, { state: 'resolved', byName: long }), pos: 1 };
    expect(parseExternalChange(readJsonPayload(decoder))).toEqual({
      state: 'resolved',
      byName: long,
    });
  });

  it('rejects truncated or non-JSON payloads', () => {
    const full = encode(21, { locked: true, byName: 'Tim' });
    expect(readJsonPayload({ arr: full.subarray(0, full.length - 3), pos: 1 })).toBeNull();
    expect(readJsonPayload({ arr: new Uint8Array([21, 2, 0x7b, 0x7b]), pos: 1 })).toBeNull();
  });

  it('validates pending and lock payloads', () => {
    expect(
      parseExternalChange({
        state: 'pending',
        externalVersionId: 'v1',
        authorName: 'Agent',
        at: '2026-10-29T10:00:00.000Z',
        kind: 'EXTERNAL',
        draftAuthorName: 'Tim',
      }),
    ).toMatchObject({ state: 'pending', draftAuthorName: 'Tim' });
    expect(parseExternalChange({ state: 'pending' })).toBeNull();
    expect(parseLock({ locked: true, byName: 'Tim' })).toEqual({ locked: true, byName: 'Tim' });
    expect(parseLock({})).toBeNull();
  });
});

describe('parseAccess', () => {
  it('accepts { canEdit } and rejects anything else', () => {
    expect(parseAccess({ canEdit: false })).toEqual({ canEdit: false });
    expect(parseAccess({ canEdit: 'no' })).toBeNull();
    expect(parseAccess(null)).toBeNull();
  });
});
