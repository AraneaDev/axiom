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
 * @param query - The query params object with optional limit and offset strings
 * @param defaults - Default values for limit and offset
 * @returns Object with take and skip values clamped to valid ranges
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
 * @param data - The array of items for the current page
 * @param total - The total count of matching items
 * @param take - The page size (limit)
 * @param skip - The offset
 * @returns Paginated response with data, total, limit, offset, and hasMore flag
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
