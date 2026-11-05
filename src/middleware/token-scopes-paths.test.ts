/**
 * normalizeApiPath gives every spelling Express routes to the same handler one form: trailing
 * slashes, case, doubled slashes and percent-encoding. The audit and NUL guards match with it.
 */
import { describe, expect, it } from 'vitest';

import { normalizeApiPath } from './token-scopes';

describe('normalizeApiPath', () => {
  it.each([
    ['/api/projects/a%2Fb', '/api/projects/a%2fb'],
    ['/api/projects/a%2fb', '/api/projects/a%2fb'],
    ['/api/projects/a%5Cb', '/api/projects/a%5cb'],
    ['/api/projects/a%2F', '/api/projects/a%2f'],
  ])('keeps an encoded slash or backslash inside its segment: %s', (raw, normal) => {
    expect(normalizeApiPath(raw)).toBe(normal);
  });

  it('still decodes everything else', () => {
    expect(normalizeApiPath('/api/%70rojects/a%20b')).toBe('/api/projects/a b');
    expect(normalizeApiPath('/api/projects/a%252Fb')).toBe('/api/projects/a%2fb');
  });

  it('lower-cases, collapses doubled slashes and drops trailing ones', () => {
    expect(normalizeApiPath('/API//Projects/X//')).toBe('/api/projects/x');
    expect(normalizeApiPath('/')).toBe('/');
  });
});
