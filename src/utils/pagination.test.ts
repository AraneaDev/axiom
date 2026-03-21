import { describe, it, expect } from 'vitest';

import { parsePagination, parseServicePagination, paginatedResponse } from './pagination';

describe('parsePagination', () => {
  it('should return default values when no query params', () => {
    const result = parsePagination({});
    expect(result).toEqual({ take: 20, skip: 0 });
  });

  it('should use custom defaults', () => {
    const result = parsePagination({}, { limit: 50, offset: 10 });
    expect(result).toEqual({ take: 50, skip: 10 });
  });

  it('should parse limit and offset from query strings', () => {
    const result = parsePagination({ limit: '15', offset: '30' });
    expect(result).toEqual({ take: 15, skip: 30 });
  });

  it('should clamp take to minimum of 1', () => {
    const result = parsePagination({ limit: '0' });
    expect(result.take).toBe(1);
  });

  it('should clamp skip to minimum of 0', () => {
    const result = parsePagination({ offset: '-5' });
    expect(result.skip).toBe(0);
  });

  it('should produce NaN when given non-numeric strings', () => {
    const result = parsePagination({ limit: 'abc', offset: 'xyz' });
    // parseInt('abc') = NaN; the ternary sees the truthy string and parses it
    // Math.max(1, NaN) = NaN
    expect(result.take).toBeNaN();
    expect(result.skip).toBeNaN();
  });
});

describe('parseServicePagination', () => {
  it('should return default values when no opts provided', () => {
    const result = parseServicePagination();
    expect(result).toEqual({ take: 25, skip: 0 });
  });

  it('should use custom default limit', () => {
    const result = parseServicePagination(undefined, 50);
    expect(result).toEqual({ take: 50, skip: 0 });
  });

  it('should use provided limit and offset', () => {
    const result = parseServicePagination({ limit: 10, offset: 20 });
    expect(result).toEqual({ take: 10, skip: 20 });
  });

  it('should clamp take to minimum of 1', () => {
    const result = parseServicePagination({ limit: 0 });
    expect(result.take).toBe(1);
  });

  it('should clamp take to maximum of 100', () => {
    const result = parseServicePagination({ limit: 500 });
    expect(result.take).toBe(100);
  });

  it('should clamp skip to minimum of 0', () => {
    const result = parseServicePagination({ offset: -10 });
    expect(result.skip).toBe(0);
  });

  it('should handle partial opts with only limit', () => {
    const result = parseServicePagination({ limit: 15 });
    expect(result).toEqual({ take: 15, skip: 0 });
  });

  it('should handle partial opts with only offset', () => {
    const result = parseServicePagination({ offset: 30 });
    expect(result).toEqual({ take: 25, skip: 30 });
  });
});

describe('paginatedResponse', () => {
  it('should return hasMore=true when more items exist', () => {
    const result = paginatedResponse(['a', 'b', 'c'], 10, 3, 0);
    expect(result).toEqual({
      data: ['a', 'b', 'c'],
      total: 10,
      limit: 3,
      offset: 0,
      hasMore: true,
    });
  });

  it('should return hasMore=false when all items returned', () => {
    const result = paginatedResponse(['a', 'b'], 2, 10, 0);
    expect(result).toEqual({
      data: ['a', 'b'],
      total: 2,
      limit: 10,
      offset: 0,
      hasMore: false,
    });
  });

  it('should account for offset in hasMore calculation', () => {
    const result = paginatedResponse(['d', 'e'], 5, 2, 3);
    expect(result.hasMore).toBe(false); // 3 + 2 = 5, not < 5
  });

  it('should return hasMore=true with offset when more items remain', () => {
    const result = paginatedResponse(['c', 'd'], 5, 2, 2);
    expect(result.hasMore).toBe(true); // 2 + 2 = 4, < 5
  });
});
