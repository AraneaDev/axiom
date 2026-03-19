/**
 * Shared pagination utilities for list endpoints.
 */

interface PaginationQuery {
  limit?: string;
  offset?: string;
}

interface PaginationDefaults {
  limit?: number;
  offset?: number;
}

/**
 * Parse limit/offset query params into Prisma-compatible take/skip values.
 * @param query
 * @param defaults
 */
export function parsePagination(
  query: PaginationQuery,
  defaults: PaginationDefaults = {},
): { take: number; skip: number } {
  const limit = defaults.limit ?? 20;
  const offset = defaults.offset ?? 0;
  const take = query.limit ? parseInt(query.limit, 10) : limit;
  const skip = query.offset ? parseInt(query.offset, 10) : offset;
  return { take: Math.max(1, take), skip: Math.max(0, skip) };
}

/**
 * Wrap a list result with standard pagination metadata.
 * @param data
 * @param total
 * @param take
 * @param skip
 */
export function paginatedResponse<T>(
  data: T[],
  total: number,
  take: number,
  skip: number,
): { data: T[]; total: number; limit: number; offset: number; hasMore: boolean } {
  return {
    data,
    total,
    limit: take,
    offset: skip,
    hasMore: skip + data.length < total,
  };
}
