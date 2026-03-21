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
 * Parse numeric limit/offset options (used in services) into clamped Prisma take/skip values.
 * Clamps take to [1, 100] and skip to [0, Infinity].
 * @param opts - Optional object with numeric limit and offset
 * @param opts.limit
 * @param opts.offset
 * @param defaultLimit - Default limit when opts.limit is undefined (default 25)
 * @returns Object with take and skip values clamped to valid ranges
 */
export function parseServicePagination(
  opts?: { limit?: number; offset?: number },
  defaultLimit = 25,
): { take: number; skip: number } {
  const take = Math.min(Math.max(opts?.limit ?? defaultLimit, 1), 100);
  const skip = Math.max(opts?.offset ?? 0, 0);
  return { take, skip };
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
